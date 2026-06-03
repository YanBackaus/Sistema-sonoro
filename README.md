# D1 mini Scheduler API

Projeto para controlar varios `D1 mini` por uma API em `Node.js`.

Cada placa:

1. conecta no Wi-Fi
2. sincroniza configuracao com a API
3. toca um sinal sonoro em horarios definidos
4. mostra status e menu em um OLED SSD1306
5. continua operando offline com a ultima agenda salva
6. envia heartbeat e eventos para o servidor

O menu do firmware foi reorganizado com a mesma ideia de maquina de estados do arquivo `Sensor.ino` que voce enviou.

## Arquitetura

`API Node.js + MySQL <-> D1 mini + buzzer + OLED + encoder`

### Papel da API

- cadastrar dispositivos
- guardar horarios por dispositivo
- entregar configuracao para cada placa
- receber heartbeat
- registrar eventos como `alarm_triggered` e `manual_test`

### Papel do D1 mini

- consultar a API periodicamente
- manter relogio sincronizado
- tocar buzzer nos horarios programados
- permitir navegacao local no OLED

## Estrutura

```text
api/
  .env.example
  index.js
  package.json
  public/
    admin/
      app.js
      index.html
      styles.css
  src/
    config.js
    db.js
    server.js
    validation.js
  vercel.json
database/
  schema.sql
esp32/
  esp32_oled_mysql_firebase/
    esp32_oled_mysql_firebase.ino
dashboard/
  app.js
  index.html
  styles.css
```

`dashboard/` agora virou o painel web de administracao da agenda sonora. A API entrega esse painel em `GET /admin`.
Para deploy na `Vercel`, o painel e sincronizado para `api/public/admin`.

## Banco MySQL

Execute [schema.sql](/C:/Users/Schenkel_Dell/Desktop/marcelo/database/schema.sql).

As tabelas novas importantes sao:

- `devices`
- `device_schedules`
- `device_events`

## API Node.js

Instalacao:

```powershell
cd C:\Users\Schenkel_Dell\Desktop\marcelo\api
npm install
```

Configure `.env` a partir de [.env.example](/C:/Users/Schenkel_Dell/Desktop/marcelo/api/.env.example).

### Variaveis principais

- `PORT`
- `ADMIN_API_KEY`
- `API_KEY` como fallback de compatibilidade
- `DEVICE_KEY_PEPPER`
- `EXPOSE_ERROR_DETAILS`
- `DEFAULT_UTC_OFFSET_MINUTES`
- `DEFAULT_POLL_INTERVAL_SECONDS`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_SSL_ENABLED`
- `MYSQL_SSL_REJECT_UNAUTHORIZED`
- `MYSQL_SSL_CA`
- `MYSQL_SSL_CA_PATH`

### Rodando

```powershell
cd C:\Users\Schenkel_Dell\Desktop\marcelo\api
npm run dev
```

ou

```powershell
cd C:\Users\Schenkel_Dell\Desktop\marcelo\api
npm start
```

API padrao:

`http://localhost:3000`

### Dashboard sincronizado

O painel fonte continua em [dashboard/](/C:/Users/Schenkel_Dell/Desktop/marcelo/dashboard), mas a API agora usa:

- `api/public/admin` para servir os arquivos
- `npm run sync:dashboard` para copiar `dashboard/` para `api/public/admin`

Esse sync ja roda automaticamente em:

- `npm start`
- `npm run dev`
- `npm run vercel-build`

### Deploy na Vercel

Para a Vercel, use a pasta [api/](/C:/Users/Schenkel_Dell/Desktop/marcelo/api) como `Root Directory` do projeto.

Arquivos preparados para isso:

- [api/index.js](/C:/Users/Schenkel_Dell/Desktop/marcelo/api/index.js)
- [api/vercel.json](/C:/Users/Schenkel_Dell/Desktop/marcelo/api/vercel.json)
- [api/public/admin](/C:/Users/Schenkel_Dell/Desktop/marcelo/api/public/admin)

Passo a passo:

1. Importe o repositório na Vercel.
2. Defina `Root Directory = api`.
3. Configure as variaveis de ambiente no projeto:
   - `API_KEY`
   - `DEFAULT_UTC_OFFSET_MINUTES`
   - `DEFAULT_POLL_INTERVAL_SECONDS`
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_DATABASE`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_SSL_ENABLED`
   - `MYSQL_SSL_REJECT_UNAUTHORIZED`
   - `MYSQL_SSL_CA`
4. Garanta que o MySQL esteja hospedado fora da sua maquina e acessivel pela Vercel.
5. Faça o deploy.

Observacoes importantes:

- `PORT` e usado localmente; na Vercel a plataforma controla a porta.
- O `dashboard` e servido como arquivo estatico em `public/admin`, porque a Vercel ignora `express.static()` para assets do Express.
- O endpoint final da API vira algo como `https://seu-projeto.vercel.app`
- No firmware do D1 mini, troque `API_BASE_URL` para a URL publica da Vercel.

### Aiven + Vercel

Se o banco estiver no `Aiven`, o padrao recomendado e ativar TLS:

```env
MYSQL_HOST=seu-host.aivencloud.com
MYSQL_PORT=12345
MYSQL_DATABASE=defaultdb
MYSQL_USER=avnadmin
MYSQL_PASSWORD=sua-senha
MYSQL_SSL_ENABLED=true
MYSQL_SSL_REJECT_UNAUTHORIZED=true
MYSQL_SSL_CA=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
```

Notas:

- `MYSQL_SSL_CA` aceita o certificado CA em uma linha so, usando `\n` para quebrar linhas.
- `MYSQL_SSL_CA_PATH` e util localmente se voce preferir apontar para um arquivo `.pem`.
- Se voce quiser apenas validar a conexao rapidamente antes de configurar o CA, pode usar `MYSQL_SSL_REJECT_UNAUTHORIZED=false`, mas isso e menos seguro e nao deve ser o estado final.

## Rotas principais

### Health

`GET /health`

### Listar devices

`GET /api/devices`

### Criar ou atualizar device

`POST /api/devices`

Exemplo:

```json
{
  "device_id": "d1mini_01",
  "name": "Sala 1",
  "location": "Recepcao",
  "menu_title": "Sala 1",
  "rotate_device_api_key": true,
  "sound_enabled": true,
  "utc_offset_minutes": -180,
  "poll_interval_seconds": 60
}
```

Observacoes:

- a resposta pode trazer `provisioning.device_api_key` quando a chave do device for criada, definida manualmente ou rotacionada
- essa chave vai para o firmware como `DEVICE_API_KEY`
- o backend guarda so o hash dessa chave no banco

### Configuracao que o D1 mini consome

`GET /api/devices/:deviceId/config`

### Heartbeat do device

`POST /api/devices/:deviceId/heartbeat`

Exemplo:

```json
{
  "firmware_version": "1.0.0",
  "wifi_rssi": -58,
  "ip_address": "192.168.0.45",
  "current_screen": "home",
  "current_menu": "home",
  "local_sound_enabled": true
}
```

### Registrar evento

`POST /api/devices/:deviceId/events`

Exemplo:

```json
{
  "event_type": "alarm_triggered",
  "message": "Horario da Sala 1 executado",
  "payload": {
    "schedule_id": 3
  }
}
```

### Listar horarios de um device

`GET /api/devices/:deviceId/schedules`

### Criar horario para um device

`POST /api/devices/:deviceId/schedules`

Exemplo:

```json
{
  "label": "Entrada",
  "hour": 8,
  "minute": 0,
  "days_of_week": [1, 2, 3, 4, 5],
  "tone_hz": 2400,
  "tone_ms": 600,
  "repeat_count": 2,
  "repeat_gap_ms": 250,
  "enabled": true
}
```

`days_of_week` usa:

- `0` domingo
- `1` segunda
- `2` terca
- `3` quarta
- `4` quinta
- `5` sexta
- `6` sabado

### Atualizar horario

`PUT /api/schedules/:scheduleId`

Opcao com escopo estrito por device:

`PUT /api/devices/:deviceId/schedules/:scheduleId`

### Ativar ou desativar horario

`PATCH /api/schedules/:scheduleId/enabled`

Opcao com escopo estrito por device:

`PATCH /api/devices/:deviceId/schedules/:scheduleId/enabled`

### Excluir horario

`DELETE /api/schedules/:scheduleId`

Opcao com escopo estrito por device:

`DELETE /api/devices/:deviceId/schedules/:scheduleId`

## Painel web

Abra no navegador:

`http://localhost:3000/admin`

O painel permite:

- conectar com `API Base URL` e a chave admin
- listar os devices cadastrados
- cadastrar ou atualizar um device
- gerar ou rotacionar a chave individual de cada device
- visualizar a frota em cards com estado rapido por ESP
- selecionar o ESP ativo pela lateral e trabalhar sempre em contexto
- criar novos horarios
- editar horarios existentes
- ativar ou desativar um horario ja cadastrado
- apagar horarios existentes

O front agora deixa explicito qual ESP esta selecionado e trata a agenda como isolada por device.

Se voce abrir o painel pela propria API em `/admin`, ele ja tenta usar o mesmo host automaticamente.

## Firmware do D1 mini

Arquivo principal:

[esp32_oled_mysql_firebase.ino](/C:/Users/Schenkel_Dell/Desktop/marcelo/esp32/esp32_oled_mysql_firebase/esp32_oled_mysql_firebase.ino)

### Bibliotecas

- `Adafruit GFX Library`
- `Adafruit SSD1306`
- `ArduinoJson`

### Ajustes no inicio do arquivo

- copie [secrets.example.h](/C:/Users/Schenkel_Dell/Desktop/marcelo/esp32/esp32_oled_mysql_firebase/secrets.example.h) para `secrets.h`
- preencha `WIFI_SSID`
- preencha `WIFI_PASSWORD`
- use `API_BASE_URL` com `https://`
- grave a chave individual em `DEVICE_API_KEY`
- ajuste `DEVICE_ID`
- configure `API_ROOT_CA` com a raiz da sua API, ou use `DEVICE_ALLOW_INSECURE_TLS=true` apenas em teste local temporario

### Funcoes principais do firmware

- sincronizar com `POST /api/devices/:deviceId/heartbeat`
- carregar horarios da resposta da API
- salvar localmente a ultima configuracao e a ultima agenda valida
- tocar buzzer nos horarios configurados
- registrar evento quando um horario toca
- mostrar menu no OLED
- autenticar com `X-DEVICE-KEY`, nao mais com uma chave global compartilhada

### Menu atual no OLED

- `Voltar`
- `Som local`
- `Teste sonoro`
- `Horarios`
- `WiFi/API`
- `Sincronizar`

## Pinagem sugerida para D1 mini

OLED SSD1306 I2C:

- `D1` -> `SCL`
- `D2` -> `SDA`
- `3V3` -> `VCC`
- `G` -> `GND`

Buzzer:

- `D5` -> sinal do buzzer

LED interno do D1 mini:

- `D4` -> acende como fallback visual quando `Som local` estiver `OFF`

Encoder:

- `D6` -> canal A
- `D7` -> canal B
- `D3` -> botao

Observacao:

- `D3` participa do boot do ESP8266, entao evite manter o botao pressionado ao ligar a placa

## Exemplo rapido de uso

1. Suba a API.
2. Execute o schema no MySQL.
3. Cadastre o device com `POST /api/devices`.
4. Crie os horarios com `POST /api/devices/:deviceId/schedules`.
5. Abra `http://localhost:3000/admin`.
6. Cadastre os horarios pelo painel.
7. Grave o firmware no D1 mini.
8. Ligue a placa e acompanhe os heartbeats e eventos.

## Observacoes

- O firmware ainda esta com foco em buzzer + menu + agenda, sem sensor.
- Se `Som local` estiver `OFF`, o firmware usa o LED interno no teste sonoro e nos horarios agendados em vez do buzzer.
- A placa entra em modo offline com a ultima agenda salva quando a API ou o Wi-Fi caem.
- As tentativas de Wi-Fi/API continuam periodicas, mas ficam pausadas perto do proximo horario para priorizar o toque.
- O painel atual cobre cadastro, edicao, ativacao, desativacao e exclusao de horarios. Se voce quiser, o proximo passo natural e adicionar uma pagina de eventos.
- O acesso admin e separado da autenticacao dos devices. Cada placa deve ter sua propria `DEVICE_API_KEY`.
- Para ambiente local com Aiven, prefira `MYSQL_SSL_CA_PATH` apontando para um `.pem`; para Vercel, use `MYSQL_SSL_CA` no painel de envs.
