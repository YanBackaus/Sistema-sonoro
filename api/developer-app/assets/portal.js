const elements = {
  banner: document.querySelector("#developerBanner"),
  sessionChip: document.querySelector("#developerSessionChip"),
  refreshButton: document.querySelector("#developerRefreshButton"),
  logoutButton: document.querySelector("#developerLogoutButton"),
  deviceList: document.querySelector("#developerDeviceList"),
  deviceTitle: document.querySelector("#developerDeviceTitle"),
  deviceForm: document.querySelector("#developerDeviceForm"),
  deviceIdInput: document.querySelector("#developerDeviceIdInput"),
  deviceNameInput: document.querySelector("#developerDeviceNameInput"),
  deviceLocationInput: document.querySelector("#developerDeviceLocationInput"),
  deviceMenuInput: document.querySelector("#developerDeviceMenuInput"),
  deviceUtcOffsetInput: document.querySelector("#developerDeviceUtcOffsetInput"),
  devicePollInput: document.querySelector("#developerDevicePollInput"),
  deviceSoundInput: document.querySelector("#developerDeviceSoundInput"),
  deviceKeyInput: document.querySelector("#developerDeviceKeyInput"),
  rotateKeyInput: document.querySelector("#developerRotateKeyInput"),
  deviceResetButton: document.querySelector("#developerDeviceResetButton"),
  deviceDeleteButton: document.querySelector("#developerDeviceDeleteButton"),
  provisioningCard: document.querySelector("#developerProvisioningCard"),
  provisioningValue: document.querySelector("#developerProvisioningValue"),
  deviceSummary: document.querySelector("#developerDeviceSummary"),
  deploymentHistory: document.querySelector("#developerDeploymentHistory"),
  releaseForm: document.querySelector("#developerReleaseForm"),
  releaseVersionInput: document.querySelector("#developerReleaseVersionInput"),
  releaseChannelInput: document.querySelector("#developerReleaseChannelInput"),
  releaseUrlInput: document.querySelector("#developerReleaseUrlInput"),
  releaseShaInput: document.querySelector("#developerReleaseShaInput"),
  releaseNotesInput: document.querySelector("#developerReleaseNotesInput"),
  releaseSelect: document.querySelector("#developerReleaseSelect"),
  deploymentForm: document.querySelector("#developerDeploymentForm"),
  deployTargetSelect: document.querySelector("#developerDeployTargetSelect"),
  releaseList: document.querySelector("#developerReleaseList"),
  statDevices: document.querySelector("#statDevices"),
  statOnline: document.querySelector("#statOnline"),
  statReleases: document.querySelector("#statReleases"),
  statPendingDeployments: document.querySelector("#statPendingDeployments"),
};

const state = {
  devices: [],
  releases: [],
  selectedDeviceId: null,
  selectedReleaseId: null,
};

bootstrap();

async function bootstrap() {
  try {
    await ensureSession();
  } catch (error) {
    window.location.replace("/developer/login");
    return;
  }

  bindEvents();
  await refreshOverview();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => refreshOverview("Dados atualizados."));
  elements.logoutButton.addEventListener("click", logout);
  elements.deviceForm.addEventListener("submit", submitDeviceForm);
  elements.deviceResetButton.addEventListener("click", resetDeviceForm);
  elements.deviceDeleteButton.addEventListener("click", deleteSelectedDevice);
  elements.releaseForm.addEventListener("submit", submitReleaseForm);
  elements.deploymentForm.addEventListener("submit", submitDeploymentForm);
}

async function ensureSession() {
  const payload = await fetchJson("/api/developer/session");
  const expiresAt = payload.expires_at ? new Date(payload.expires_at) : null;
  elements.sessionChip.textContent = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? `Sessao ate ${formatDateTime(expiresAt)}`
    : "Sessao ativa";
}

async function refreshOverview(successMessage = "") {
  setBanner("Carregando portal...", "");

  try {
    const payload = await fetchJson("/api/developer/overview");
    state.devices = Array.isArray(payload.devices) ? payload.devices : [];
    state.releases = Array.isArray(payload.releases) ? payload.releases : [];

    if (state.selectedDeviceId && !state.devices.some((device) => device.device_id === state.selectedDeviceId)) {
      state.selectedDeviceId = null;
    }

    if (!state.selectedDeviceId && state.devices.length > 0) {
      state.selectedDeviceId = state.devices[0].device_id;
    }

    if (state.selectedReleaseId && !state.releases.some((release) => String(release.id) === String(state.selectedReleaseId))) {
      state.selectedReleaseId = null;
    }

    updateStats(payload.summary || {});
    renderDeviceList();
    renderReleaseOptions();
    renderReleaseList();

    if (state.selectedDeviceId) {
      await loadDeviceDetails(state.selectedDeviceId, {
        silent: true,
      });
    } else {
      renderDeviceSummary(null);
      renderDeploymentHistory([]);
      resetDeviceForm();
    }

    setBanner(successMessage || "Portal pronto.", "success");
  } catch (error) {
    if (error.status === 401) {
      window.location.replace("/developer/login");
      return;
    }

    console.error(error);
    setBanner(error.message || "Nao foi possivel carregar o portal.", "error");
  }
}

function updateStats(summary) {
  elements.statDevices.textContent = numberOrDash(summary.total_devices);
  elements.statOnline.textContent = numberOrDash(summary.online_devices);
  elements.statReleases.textContent = numberOrDash(summary.total_releases);
  elements.statPendingDeployments.textContent = numberOrDash(summary.pending_deployments);
}

function renderDeviceList() {
  if (!state.devices.length) {
    elements.deviceList.innerHTML = '<div class="empty-state">Nenhum ESP cadastrado.</div>';
    return;
  }

  elements.deviceList.innerHTML = state.devices.map((device) => {
    const isActive = device.device_id === state.selectedDeviceId;
    const latestDeployment = device.latest_deployment;
    const deploymentLabel = latestDeployment
      ? `${statusLabel(latestDeployment.status)} ${escapeHtml(latestDeployment.release.version)}`
      : "Sem deploy recente";

    return `
      <button type="button" class="developer-device-card ${isActive ? "active" : ""}" data-device-id="${escapeHtml(device.device_id)}">
        <div class="developer-card-top">
          <div>
            <h3 class="developer-card-title">${escapeHtml(device.name || device.device_id)}</h3>
            <p class="developer-card-copy">${escapeHtml(device.device_id)}${device.location ? ` · ${escapeHtml(device.location)}` : ""}</p>
          </div>
          <span class="developer-badge ${device.last_seen_at ? "developer-badge-success" : ""}">
            ${device.last_seen_at ? "Online" : "Sem contato"}
          </span>
        </div>

        <div class="developer-card-bottom">
          <span class="developer-badge">Agenda ativa: ${numberOrDash(device.active_schedule_count)}</span>
          <span class="developer-badge">FW: ${escapeHtml(device.firmware_version || "--")}</span>
          <span class="developer-badge ${deploymentBadgeClass(latestDeployment?.status)}">${deploymentLabel}</span>
        </div>
      </button>
    `;
  }).join("");

  for (const button of elements.deviceList.querySelectorAll("[data-device-id]")) {
    button.addEventListener("click", () => {
      const { deviceId } = button.dataset;
      if (deviceId) {
        loadDeviceDetails(deviceId);
      }
    });
  }
}

async function loadDeviceDetails(deviceId, options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setBanner(`Carregando ${deviceId}...`, "");
  }

  try {
    const payload = await fetchJson(`/api/developer/devices/${encodeURIComponent(deviceId)}`);
    state.selectedDeviceId = payload.device.device_id;
    fillDeviceForm(payload.device);
    renderDeviceSummary(payload.device);
    renderDeploymentHistory(payload.device.deployments || []);
    renderDeviceList();

    if (!silent) {
      setBanner(`ESP ${payload.device.device_id} carregado.`, "success");
    }
  } catch (error) {
    if (error.status === 401) {
      window.location.replace("/developer/login");
      return;
    }

    console.error(error);
    setBanner(error.message || "Nao foi possivel abrir o ESP.", "error");
  }
}

function fillDeviceForm(device) {
  elements.deviceTitle.textContent = device.device_id;
  elements.deviceIdInput.value = device.device_id || "";
  elements.deviceIdInput.readOnly = true;
  elements.deviceNameInput.value = device.name || "";
  elements.deviceLocationInput.value = device.location || "";
  elements.deviceMenuInput.value = device.menu_title || "";
  elements.deviceUtcOffsetInput.value = String(device.utc_offset_minutes ?? -180);
  elements.devicePollInput.value = String(device.poll_interval_seconds ?? 60);
  elements.deviceSoundInput.checked = Boolean(device.sound_enabled);
  elements.deviceKeyInput.value = "";
  elements.rotateKeyInput.checked = false;
  elements.deviceDeleteButton.hidden = false;
  hideProvisioningCard();
}

function resetDeviceForm() {
  state.selectedDeviceId = null;
  elements.deviceTitle.textContent = "Novo ESP";
  elements.deviceForm.reset();
  elements.deviceIdInput.readOnly = false;
  elements.deviceUtcOffsetInput.value = "-180";
  elements.devicePollInput.value = "60";
  elements.deviceSoundInput.checked = true;
  elements.deviceDeleteButton.hidden = true;
  hideProvisioningCard();
  renderDeviceSummary(null);
  renderDeploymentHistory([]);
  renderDeviceList();
}

async function submitDeviceForm(event) {
  event.preventDefault();

  const payload = {
    device_id: elements.deviceIdInput.value.trim(),
    name: elements.deviceNameInput.value.trim(),
    location: elements.deviceLocationInput.value.trim(),
    menu_title: elements.deviceMenuInput.value.trim(),
    utc_offset_minutes: Number.parseInt(elements.deviceUtcOffsetInput.value, 10),
    poll_interval_seconds: Number.parseInt(elements.devicePollInput.value, 10),
    sound_enabled: elements.deviceSoundInput.checked,
    device_api_key: elements.deviceKeyInput.value.trim(),
    rotate_device_api_key: elements.rotateKeyInput.checked,
  };

  setBanner("Salvando ESP...", "");

  try {
    const response = await fetchJson("/api/developer/devices", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.selectedDeviceId = response.device.device_id;
    if (response.provisioning?.device_api_key) {
      showProvisioningCard(response.provisioning.device_api_key);
    } else {
      hideProvisioningCard();
    }

    await refreshOverview(`ESP ${response.device.device_id} salvo.`);
  } catch (error) {
    console.error(error);
    setBanner(error.message || "Nao foi possivel salvar o ESP.", "error");
  }
}

async function deleteSelectedDevice() {
  const deviceId = state.selectedDeviceId;
  if (!deviceId) {
    setBanner("Escolha um ESP antes de excluir.", "error");
    return;
  }

  const confirmed = window.confirm(`Excluir o ESP ${deviceId}? Essa acao remove horarios e deploys ligados a ele.`);
  if (!confirmed) {
    return;
  }

  setBanner(`Excluindo ${deviceId}...`, "");

  try {
    await fetchJson(`/api/developer/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    });

    resetDeviceForm();
    await refreshOverview(`ESP ${deviceId} excluido.`);
  } catch (error) {
    console.error(error);
    setBanner(error.message || "Nao foi possivel excluir o ESP.", "error");
  }
}

async function submitReleaseForm(event) {
  event.preventDefault();

  const payload = {
    version: elements.releaseVersionInput.value.trim(),
    channel: elements.releaseChannelInput.value.trim(),
    firmware_url: elements.releaseUrlInput.value.trim(),
    sha256: elements.releaseShaInput.value.trim(),
    notes: elements.releaseNotesInput.value.trim(),
  };

  setBanner("Salvando release...", "");

  try {
    const response = await fetchJson("/api/developer/releases", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.selectedReleaseId = response.release?.id || null;
    elements.releaseForm.reset();
    elements.releaseChannelInput.value = "stable";
    await refreshOverview(`Release ${response.release.version} salva.`);
    if (state.selectedReleaseId) {
      elements.releaseSelect.value = String(state.selectedReleaseId);
    }
  } catch (error) {
    console.error(error);
    setBanner(error.message || "Nao foi possivel salvar a release.", "error");
  }
}

async function submitDeploymentForm(event) {
  event.preventDefault();

  const releaseId = elements.releaseSelect.value;
  if (!releaseId) {
    setBanner("Escolha uma release antes de enviar.", "error");
    return;
  }

  const target = elements.deployTargetSelect.value;
  let deviceIds = [];
  if (target === "selected") {
    if (!state.selectedDeviceId) {
      setBanner("Selecione um ESP para esse deploy.", "error");
      return;
    }
    deviceIds = [state.selectedDeviceId];
  }

  setBanner("Enviando OTA...", "");

  try {
    const response = await fetchJson(`/api/developer/releases/${encodeURIComponent(releaseId)}/deploy`, {
      method: "POST",
      body: JSON.stringify({
        device_ids: deviceIds,
      }),
    });

    await refreshOverview(
      response.created > 0
        ? `OTA enviada para ${response.created} ESP(s).`
        : "Nenhum ESP elegivel para o deploy."
    );
  } catch (error) {
    console.error(error);
    setBanner(error.message || "Nao foi possivel enviar a OTA.", "error");
  }
}

function renderReleaseOptions() {
  const previousValue = elements.releaseSelect.value;
  const options = ['<option value="">Selecione uma release</option>'];

  for (const release of state.releases) {
    options.push(
      `<option value="${release.id}">${escapeHtml(release.version)} · ${escapeHtml(release.channel || "stable")}</option>`
    );
  }

  elements.releaseSelect.innerHTML = options.join("");

  const nextValue = String(state.selectedReleaseId || previousValue || "");
  if (nextValue && state.releases.some((release) => String(release.id) === nextValue)) {
    elements.releaseSelect.value = nextValue;
  }
}

function renderReleaseList() {
  if (!state.releases.length) {
    elements.releaseList.innerHTML = '<div class="empty-state">Nenhuma release cadastrada.</div>';
    return;
  }

  elements.releaseList.innerHTML = state.releases.map((release) => `
    <article class="developer-release-card">
      <div class="developer-card-top">
        <div>
          <h3 class="developer-card-title">${escapeHtml(release.version)}</h3>
          <p class="developer-card-copy">${escapeHtml(release.channel || "stable")} · ${escapeHtml(release.firmware_url)}</p>
        </div>
        <span class="developer-badge ${release.active_deployments ? "developer-badge-warning" : ""}">
          ${release.active_deployments ? `${release.active_deployments} pendente(s)` : "Livre"}
        </span>
      </div>
      <div class="developer-card-bottom">
        <span class="developer-badge">Criada em ${formatDateTime(release.created_at)}</span>
        ${release.sha256 ? `<span class="developer-badge">SHA ok</span>` : ""}
      </div>
      ${release.notes ? `<p class="developer-card-copy developer-card-copy-spaced">${escapeHtml(release.notes)}</p>` : ""}
      <div class="developer-release-actions">
        <button type="button" class="button-secondary" data-pick-release="${release.id}">Usar neste deploy</button>
      </div>
    </article>
  `).join("");

  for (const button of elements.releaseList.querySelectorAll("[data-pick-release]")) {
    button.addEventListener("click", () => {
      state.selectedReleaseId = button.dataset.pickRelease;
      renderReleaseOptions();
      elements.releaseSelect.value = String(state.selectedReleaseId);
      setBanner("Release selecionada para o deploy.", "success");
    });
  }
}

function renderDeviceSummary(device) {
  if (!device) {
    elements.deviceSummary.innerHTML = `
      <strong>Nenhum ESP selecionado</strong>
      <p>Escolha um dispositivo na lista para ver detalhes e deploys recentes.</p>
    `;
    return;
  }

  elements.deviceSummary.innerHTML = `
    <strong>${escapeHtml(device.name || device.device_id)}</strong>
    <div class="developer-meta-grid">
      <span class="developer-badge">${escapeHtml(device.device_id)}</span>
      <span class="developer-badge">${device.location ? escapeHtml(device.location) : "Sem local"}</span>
      <span class="developer-badge">FW ${escapeHtml(device.firmware_version || "--")}</span>
      <span class="developer-badge">${device.last_seen_at ? `Ultimo contato ${formatDateTime(device.last_seen_at)}` : "Nunca sincronizou"}</span>
      <span class="developer-badge">Agenda ativa ${numberOrDash(device.schedules?.filter((schedule) => schedule.enabled).length)}</span>
      <span class="developer-badge">${device.device_api_key_last4 ? `Chave ...${escapeHtml(device.device_api_key_last4)}` : "Sem chave"}</span>
    </div>
  `;
}

function renderDeploymentHistory(deployments) {
  if (!Array.isArray(deployments) || !deployments.length) {
    elements.deploymentHistory.innerHTML = '<div class="empty-state">Nenhum deployment para mostrar.</div>';
    return;
  }

  elements.deploymentHistory.innerHTML = deployments.map((deployment) => `
    <article class="developer-release-card">
      <div class="developer-card-top">
        <div>
          <h3 class="developer-card-title">${escapeHtml(deployment.release.version)}</h3>
          <p class="developer-card-copy">${escapeHtml(deployment.release.channel || "stable")} · ${statusLabel(deployment.status)}</p>
        </div>
        <span class="developer-badge ${deploymentBadgeClass(deployment.status)}">${statusLabel(deployment.status)}</span>
      </div>
      <div class="developer-card-bottom">
        <span class="developer-badge">Pedido em ${formatDateTime(deployment.requested_at)}</span>
        ${deployment.applied_at ? `<span class="developer-badge developer-badge-success">Aplicado em ${formatDateTime(deployment.applied_at)}</span>` : ""}
        ${deployment.failed_at ? `<span class="developer-badge developer-badge-danger">Falhou em ${formatDateTime(deployment.failed_at)}</span>` : ""}
      </div>
      ${deployment.last_error ? `<p class="developer-card-copy developer-card-copy-spaced">${escapeHtml(deployment.last_error)}</p>` : ""}
      ${["pending", "applying"].includes(deployment.status)
        ? `<div class="developer-release-actions"><button type="button" class="button-secondary" data-cancel-deployment="${deployment.deployment_id}">Cancelar deploy</button></div>`
        : ""}
    </article>
  `).join("");

  for (const button of elements.deploymentHistory.querySelectorAll("[data-cancel-deployment]")) {
    button.addEventListener("click", async () => {
      const deploymentId = button.dataset.cancelDeployment;
      if (!deploymentId) {
        return;
      }

      setBanner("Cancelando deploy...", "");
      try {
        await fetchJson(`/api/developer/deployments/${encodeURIComponent(deploymentId)}/cancel`, {
          method: "POST",
        });
        await refreshOverview("Deploy cancelado.");
      } catch (error) {
        console.error(error);
        setBanner(error.message || "Nao foi possivel cancelar o deploy.", "error");
      }
    });
  }
}

function showProvisioningCard(deviceApiKey) {
  elements.provisioningCard.hidden = false;
  elements.provisioningValue.textContent = deviceApiKey;
}

function hideProvisioningCard() {
  elements.provisioningCard.hidden = true;
  elements.provisioningValue.textContent = "";
}

async function logout() {
  try {
    await fetchJson("/api/developer/session", {
      method: "DELETE",
    });
  } catch (error) {
    console.error(error);
  }

  window.location.replace("/developer/login");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.details || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function setBanner(message, tone) {
  elements.banner.textContent = message;
  elements.banner.dataset.tone = tone || "";
}

function statusLabel(status) {
  switch (status) {
    case "pending":
      return "Pendente";
    case "applying":
      return "Aplicando";
    case "applied":
      return "Aplicado";
    case "failed":
      return "Falhou";
    case "cancelled":
      return "Cancelado";
    default:
      return status || "Sem status";
  }
}

function deploymentBadgeClass(status) {
  switch (status) {
    case "pending":
    case "applying":
      return "developer-badge-warning";
    case "applied":
      return "developer-badge-success";
    case "failed":
    case "cancelled":
      return "developer-badge-danger";
    default:
      return "";
  }
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  return parsed.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function numberOrDash(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "--";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
