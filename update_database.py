from __future__ import annotations

import argparse
import os
import ssl
import sys
import tempfile
from pathlib import Path

try:
    import pymysql
except ImportError as error:  # pragma: no cover - user-facing import guard
    print(
        "PyMySQL nao esta instalado. Rode: python -m pip install pymysql",
        file=sys.stderr,
    )
    raise SystemExit(1) from error


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = PROJECT_ROOT / "api" / ".env"
DEFAULT_SCHEMA_FILE = PROJECT_ROOT / "database" / "schema.sql"


def main() -> int:
    args = parse_args()
    env_values = load_env_file(args.env_file)
    schema_sql = args.schema_file.read_text(encoding="utf-8")
    statements = split_sql_statements(schema_sql)

    temp_ca_path = None
    try:
        connection = create_connection(env_values)
        temp_ca_path = env_values.get("__temp_ca_path")

        with connection:
            with connection.cursor() as cursor:
                for index, statement in enumerate(statements, start=1):
                    if args.verbose:
                        preview = compact_preview(statement)
                        print(f"[{index}/{len(statements)}] Executando: {preview}")
                    cursor.execute(statement)

            connection.commit()
    except Exception as error:
        print(f"Falha ao atualizar o banco: {error}", file=sys.stderr)
        return 1
    finally:
        if temp_ca_path and Path(temp_ca_path).exists():
            Path(temp_ca_path).unlink(missing_ok=True)

    print(
        "Banco atualizado com sucesso.",
        f"Arquivo: {args.schema_file}",
        f"Banco: {env_values['MYSQL_DATABASE']}",
        sep="\n",
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aplica o schema SQL do projeto no banco configurado em api/.env."
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help=f"Arquivo .env com as credenciais do banco. Padrao: {DEFAULT_ENV_FILE}",
    )
    parser.add_argument(
        "--schema-file",
        type=Path,
        default=DEFAULT_SCHEMA_FILE,
        help=f"Arquivo schema SQL a aplicar. Padrao: {DEFAULT_SCHEMA_FILE}",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Mostra cada comando executado.",
    )
    args = parser.parse_args()

    args.env_file = args.env_file.resolve()
    args.schema_file = args.schema_file.resolve()

    if not args.env_file.exists():
        raise SystemExit(f"Arquivo .env nao encontrado: {args.env_file}")

    if not args.schema_file.exists():
        raise SystemExit(f"Arquivo schema.sql nao encontrado: {args.schema_file}")

    return args


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    values["__env_dir"] = str(env_path.parent.resolve())

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = raw_line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]

        values[key] = value

    required = [
        "MYSQL_HOST",
        "MYSQL_PORT",
        "MYSQL_DATABASE",
        "MYSQL_USER",
    ]
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise SystemExit(
            "Faltam variaveis obrigatorias no .env: " + ", ".join(missing)
        )

    values.setdefault("MYSQL_PASSWORD", "")
    values.setdefault("MYSQL_SSL_ENABLED", "false")
    values.setdefault("MYSQL_SSL_REJECT_UNAUTHORIZED", "true")
    return values


def create_connection(env_values: dict[str, str]) -> pymysql.connections.Connection:
    ssl_config = build_ssl_config(env_values)

    return pymysql.connect(
        host=env_values["MYSQL_HOST"],
        port=int(env_values["MYSQL_PORT"]),
        user=env_values["MYSQL_USER"],
        password=env_values["MYSQL_PASSWORD"],
        database=env_values["MYSQL_DATABASE"],
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=10,
        read_timeout=20,
        write_timeout=20,
        ssl=ssl_config,
    )


def build_ssl_config(env_values: dict[str, str]) -> dict | None:
    if not parse_bool(env_values.get("MYSQL_SSL_ENABLED"), False):
        return None

    verify_cert = parse_bool(env_values.get("MYSQL_SSL_REJECT_UNAUTHORIZED"), True)
    ca_inline = env_values.get("MYSQL_SSL_CA", "").replace("\\n", "\n").strip()
    ca_path_value = env_values.get("MYSQL_SSL_CA_PATH", "").strip()
    env_dir = Path(env_values["__env_dir"])
    ca_path = None

    if ca_path_value:
        candidate = Path(ca_path_value).expanduser()
        ca_path = candidate if candidate.is_absolute() else (env_dir / candidate).resolve()

    if not ca_path and ca_inline:
        temp_file = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".pem",
            delete=False,
        )
        temp_file.write(ca_inline)
        temp_file.flush()
        temp_file.close()
        ca_path = Path(temp_file.name)
        env_values["__temp_ca_path"] = str(ca_path)

    ssl_config: dict = {
        "check_hostname": verify_cert,
        "verify_mode": ssl.CERT_REQUIRED if verify_cert else ssl.CERT_NONE,
    }

    if ca_path:
        if not ca_path.exists():
            raise SystemExit(f"Arquivo de certificado nao encontrado: {ca_path}")
        ssl_config["ca"] = str(ca_path)

    return ssl_config


def split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []
    in_single = False
    in_double = False
    in_backtick = False
    in_line_comment = False
    in_block_comment = False
    index = 0
    length = len(sql_text)

    while index < length:
        current = sql_text[index]
        next_char = sql_text[index + 1] if index + 1 < length else ""

        if in_line_comment:
            if current == "\n":
                in_line_comment = False
                buffer.append(current)
            index += 1
            continue

        if in_block_comment:
            if current == "*" and next_char == "/":
                in_block_comment = False
                index += 2
            else:
                index += 1
            continue

        if not in_single and not in_double and not in_backtick:
            if current == "-" and next_char == "-":
                in_line_comment = True
                index += 2
                continue
            if current == "#":
                in_line_comment = True
                index += 1
                continue
            if current == "/" and next_char == "*":
                in_block_comment = True
                index += 2
                continue

        if current == "'" and not in_double and not in_backtick:
            if in_single and next_char == "'":
                buffer.extend([current, next_char])
                index += 2
                continue
            in_single = not in_single
            buffer.append(current)
            index += 1
            continue

        if current == '"' and not in_single and not in_backtick:
            in_double = not in_double
            buffer.append(current)
            index += 1
            continue

        if current == "`" and not in_single and not in_double:
            in_backtick = not in_backtick
            buffer.append(current)
            index += 1
            continue

        if current == ";" and not in_single and not in_double and not in_backtick:
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer.clear()
            index += 1
            continue

        buffer.append(current)
        index += 1

    remainder = "".join(buffer).strip()
    if remainder:
        statements.append(remainder)

    return statements


def parse_bool(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default

    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise SystemExit(f"Valor booleano invalido no .env: {value}")


def compact_preview(statement: str, max_length: int = 100) -> str:
    one_line = " ".join(statement.split())
    if len(one_line) <= max_length:
        return one_line
    return one_line[: max_length - 3] + "..."


if __name__ == "__main__":
    raise SystemExit(main())
