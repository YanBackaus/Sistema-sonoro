const form = document.querySelector("#developerLoginForm");
const passwordInput = document.querySelector("#developerPasswordInput");
const hint = document.querySelector("#developerLoginHint");

bootstrap();

async function bootstrap() {
  try {
    const response = await fetch("/api/developer/session", {
      credentials: "same-origin",
    });

    if (response.ok) {
      window.location.replace("/developer");
      return;
    }
  } catch (error) {
    console.error(error);
  }

  form.addEventListener("submit", handleSubmit);
}

async function handleSubmit(event) {
  event.preventDefault();

  const password = passwordInput.value.trim();
  if (!password) {
    hint.textContent = "Digite a senha do portal.";
    return;
  }

  hint.textContent = "Entrando...";

  try {
    const response = await fetch("/api/developer/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      hint.textContent = payload?.error || "N\u00e3o foi poss\u00edvel entrar.";
      return;
    }

    window.location.replace("/developer");
  } catch (error) {
    console.error(error);
    hint.textContent = "Falha de conex\u00e3o com a API.";
  }
}
