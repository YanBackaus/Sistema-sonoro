const elements = {
  banner: document.querySelector("#developerBanner"),
  sessionChip: document.querySelector("#developerSessionChip"),
  refreshButton: document.querySelector("#developerRefreshButton"),
  logoutButton: document.querySelector("#developerLogoutButton"),
  tabButtons: [...document.querySelectorAll("[data-tab]")],
  tabPanels: [...document.querySelectorAll("[data-tab-panel]")],
  statUsers: document.querySelector("#statUsers"),
  statDevices: document.querySelector("#statDevices"),
  statOnline: document.querySelector("#statOnline"),
  statReleases: document.querySelector("#statReleases"),
  statPendingDeployments: document.querySelector("#statPendingDeployments"),

  userList: document.querySelector("#developerUserList"),
  userTitle: document.querySelector("#developerUserTitle"),
  userForm: document.querySelector("#developerUserForm"),
  userIdInput: document.querySelector("#developerUserIdInput"),
  userCompanyInput: document.querySelector("#developerUserCompanyInput"),
  userPasswordInput: document.querySelector("#developerUserPasswordInput"),
  userRotatePasswordInput: document.querySelector("#developerUserRotatePasswordInput"),
  userStatusInput: document.querySelector("#developerUserStatusInput"),
  userResetButton: document.querySelector("#developerUserResetButton"),
  userDeleteButton: document.querySelector("#developerUserDeleteButton"),
  userProvisioningCard: document.querySelector("#developerUserProvisioningCard"),
  userProvisioningTitle: document.querySelector("#developerUserProvisioningTitle"),
  userProvisioningValue: document.querySelector("#developerUserProvisioningValue"),
  userProvisioningHint: document.querySelector("#developerUserProvisioningHint"),
  userSummary: document.querySelector("#developerUserSummary"),

  deviceList: document.querySelector("#developerDeviceList"),
  deviceTitle: document.querySelector("#developerDeviceTitle"),
  deviceForm: document.querySelector("#developerDeviceForm"),
  deviceIdInput: document.querySelector("#developerDeviceIdInput"),
  deviceNameInput: document.querySelector("#developerDeviceNameInput"),
  deviceOwnerInput: document.querySelector("#developerDeviceOwnerInput"),
  deviceLocationInput: document.querySelector("#developerDeviceLocationInput"),
  deviceMenuInput: document.querySelector("#developerDeviceMenuInput"),
  deviceHardwareModelInput: document.querySelector("#developerDeviceHardwareModelInput"),
  deviceFirmwareProfileInput: document.querySelector("#developerDeviceFirmwareProfileInput"),
  devicePollInput: document.querySelector("#developerDevicePollInput"),
  deviceUtcOffsetInput: document.querySelector("#developerDeviceUtcOffsetInput"),
  deviceSoundInput: document.querySelector("#developerDeviceSoundInput"),
  deviceKeyInput: document.querySelector("#developerDeviceKeyInput"),
  rotateKeyInput: document.querySelector("#developerRotateKeyInput"),
  generateRecoveryKeyButton: document.querySelector("#developerGenerateRecoveryKeyButton"),
  deviceResetButton: document.querySelector("#developerDeviceResetButton"),
  deviceDeleteButton: document.querySelector("#developerDeviceDeleteButton"),
  deviceProvisioningCard: document.querySelector("#developerProvisioningCard"),
  deviceProvisioningTitle: document.querySelector("#developerProvisioningTitle"),
  deviceProvisioningValue: document.querySelector("#developerProvisioningValue"),
  deviceProvisioningHint: document.querySelector("#developerProvisioningHint"),
  selectedDeviceBanner: document.querySelector("#developerSelectedDeviceBanner"),
  deviceSummary: document.querySelector("#developerDeviceSummary"),
  deploymentHistory: document.querySelector("#developerDeploymentHistory"),

  buildPlanForm: document.querySelector("#developerBuildPlanForm"),
  buildPlanDeviceInput: document.querySelector("#developerBuildPlanDeviceInput"),
  buildPlanVersionInput: document.querySelector("#developerBuildPlanVersionInput"),
  buildPlanChannelInput: document.querySelector("#developerBuildPlanChannelInput"),
  buildPlanUseButton: document.querySelector("#developerBuildPlanUseButton"),
  buildPlanCard: document.querySelector("#developerBuildPlanCard"),

  releaseForm: document.querySelector("#developerReleaseForm"),
  releaseCodeInput: document.querySelector("#developerReleaseCodeInput"),
  releaseVersionInput: document.querySelector("#developerReleaseVersionInput"),
  releaseChannelInput: document.querySelector("#developerReleaseChannelInput"),
  releaseTargetTypeInput: document.querySelector("#developerReleaseTargetTypeInput"),
  releaseTargetUserField: document.querySelector("#developerReleaseTargetUserField"),
  releaseTargetUserInput: document.querySelector("#developerReleaseTargetUserInput"),
  releaseTargetDeviceField: document.querySelector("#developerReleaseTargetDeviceField"),
  releaseTargetDeviceInput: document.querySelector("#developerReleaseTargetDeviceInput"),
  releaseHardwareModelInput: document.querySelector("#developerReleaseHardwareModelInput"),
  releaseBinaryFilenameInput: document.querySelector("#developerReleaseBinaryFilenameInput"),
  releaseSketchPathInput: document.querySelector("#developerReleaseSketchPathInput"),
  releaseUrlInput: document.querySelector("#developerReleaseUrlInput"),
  releaseShaInput: document.querySelector("#developerReleaseShaInput"),
  releaseNotesInput: document.querySelector("#developerReleaseNotesInput"),

  deploymentForm: document.querySelector("#developerDeploymentForm"),
  releaseSelect: document.querySelector("#developerReleaseSelect"),
  deployTargetSelect: document.querySelector("#developerDeployTargetSelect"),
  releaseList: document.querySelector("#developerReleaseList"),
};

const state = {
  activeTab: "users",
  users: [],
  devices: [],
  releases: [],
  selectedUserId: null,
  selectedDeviceId: null,
  selectedReleaseId: null,
  buildPlan: null,
  userProvisioning: null,
  deviceProvisioning: null,
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
  updateTabUi();
  applyBlankUserForm();
  applyBlankDeviceForm();
  updateReleaseTargetFields();
  await refreshOverview();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => refreshOverview("Portal atualizado."));
  elements.logoutButton.addEventListener("click", logout);

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab || "users";
      updateTabUi();
    });
  }

  elements.userForm.addEventListener("submit", submitUserForm);
  elements.userResetButton.addEventListener("click", resetUserForm);
  elements.userDeleteButton.addEventListener("click", deleteSelectedUser);

  elements.deviceForm.addEventListener("submit", submitDeviceForm);
  elements.deviceLocationInput.addEventListener("input", syncDeviceMenuFromLocation);
  elements.generateRecoveryKeyButton.addEventListener("click", generateRecoveryKeyForSelectedDevice);
  elements.deviceResetButton.addEventListener("click", resetDeviceForm);
  elements.deviceDeleteButton.addEventListener("click", deleteSelectedDevice);

  elements.buildPlanForm.addEventListener("submit", submitBuildPlanForm);
  elements.buildPlanUseButton.addEventListener("click", applyBuildPlanToReleaseForm);

  elements.releaseForm.addEventListener("submit", submitReleaseForm);
  elements.releaseTargetTypeInput.addEventListener("change", updateReleaseTargetFields);
  elements.deploymentForm.addEventListener("submit", submitDeploymentForm);
}

async function ensureSession() {
  const payload = await fetchJson("/api/developer/session");
  const expiresAt = payload.expires_at ? new Date(payload.expires_at) : null;
  elements.sessionChip.textContent =
    expiresAt && !Number.isNaN(expiresAt.getTime())
      ? `Sess\u00e3o at\u00e9 ${formatDateTime(expiresAt)}`
      : "Sess\u00e3o ativa";
}

async function refreshOverview(successMessage = "") {
  setBanner("Carregando portal...", "");

  try {
    const payload = await fetchJson("/api/developer/overview");
    state.users = Array.isArray(payload.users) ? payload.users : [];
    state.devices = Array.isArray(payload.devices) ? payload.devices : [];
    state.releases = Array.isArray(payload.releases) ? payload.releases : [];

    if (state.selectedUserId && !state.users.some((user) => user.user_id === state.selectedUserId)) {
      state.selectedUserId = null;
    }
    if (!state.selectedUserId && state.users.length) {
      state.selectedUserId = state.users[0].user_id;
    }

    if (state.selectedDeviceId && !state.devices.some((device) => device.device_id === state.selectedDeviceId)) {
      state.selectedDeviceId = null;
    }
    if (!state.selectedDeviceId && state.devices.length) {
      state.selectedDeviceId = state.devices[0].device_id;
    }

    if (state.selectedReleaseId && !state.releases.some((release) => String(release.id) === String(state.selectedReleaseId))) {
      state.selectedReleaseId = null;
    }

    updateStats(payload.summary || {});
    renderUserOptions();
    renderDeviceOptions();
    renderBuildPlanDeviceOptions();
    renderUserList();
    renderDeviceList();
    renderSelectedDeviceBanner();
    renderReleaseOptions();
    renderReleaseList();
    updateReleaseTargetFields();

    const detailLoads = [];
    if (state.selectedUserId) {
      detailLoads.push(loadUserDetails(state.selectedUserId, { silent: true }));
    } else {
      applyBlankUserForm();
      renderUserSummary(null);
    }

    if (state.selectedDeviceId) {
      detailLoads.push(loadDeviceDetails(state.selectedDeviceId, { silent: true }));
    } else {
      applyBlankDeviceForm();
      renderDeviceSummary(null);
      renderDeploymentHistory([]);
    }

    await Promise.all(detailLoads);
    syncUserProvisioningCard();
    syncDeviceProvisioningCard();
    renderBuildPlan();
    setBanner(successMessage || "Portal pronto.", "success");
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel carregar o portal.");
  }
}

function updateStats(summary) {
  elements.statUsers.textContent = numberOrDash(summary.total_users);
  elements.statDevices.textContent = numberOrDash(summary.total_devices);
  elements.statOnline.textContent = numberOrDash(summary.online_devices);
  elements.statReleases.textContent = numberOrDash(summary.total_releases);
  elements.statPendingDeployments.textContent = numberOrDash(summary.pending_deployments);
}

function updateTabUi() {
  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === state.activeTab;
    button.classList.toggle("is-active", isActive);
  }

  for (const panel of elements.tabPanels) {
    const isActive = panel.dataset.tabPanel === state.activeTab;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  }
}

function renderUserList() {
  if (!state.users.length) {
    elements.userList.innerHTML = '<div class="empty-state">Nenhum usu&aacute;rio cadastrado.</div>';
    return;
  }

  elements.userList.innerHTML = state.users
    .map((user) => {
      const isActive = user.user_id === state.selectedUserId;
      const statusClass = user.status === "active" ? "developer-badge-success" : "developer-badge-warning";

      return `
        <button type="button" class="developer-device-card ${isActive ? "active" : ""}" data-user-id="${escapeHtml(user.user_id)}">
          <div class="developer-card-top">
            <div>
              <h3 class="developer-card-title">${escapeHtml(user.company_name || user.user_id)}</h3>
              <p class="developer-card-copy">${escapeHtml(user.user_id)}</p>
            </div>
            <span class="developer-badge ${statusClass}">${user.status === "active" ? "Ativo" : "Pausado"}</span>
          </div>
          <div class="developer-card-bottom">
            <span class="developer-badge">${Number(user.device_count || 0)} ESP(s)</span>
            ${user.password_temporary ? '<span class="developer-badge developer-badge-warning">Troca pendente</span>' : ""}
          </div>
        </button>
      `;
    })
    .join("");

  for (const button of elements.userList.querySelectorAll("[data-user-id]")) {
    button.addEventListener("click", () => {
      const userId = button.dataset.userId;
      if (userId) {
        loadUserDetails(userId);
      }
    });
  }
}

async function loadUserDetails(userId, options = {}) {
  if (!options.silent) {
    setBanner(`Carregando ${userId}...`, "");
  }

  try {
    const payload = await fetchJson(`/api/developer/users/${encodeURIComponent(userId)}`);
    state.selectedUserId = payload.user.user_id;
    fillUserForm(payload.user);
    renderUserSummary(payload.user);
    renderUserList();
    syncUserProvisioningCard();

    if (!options.silent) {
      setBanner(`Usu\u00e1rio ${payload.user.user_id} carregado.`, "success");
    }
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel abrir o usu\u00e1rio.");
  }
}

function fillUserForm(user) {
  elements.userTitle.textContent = user.company_name || user.user_id;
  elements.userIdInput.value = user.user_id || "";
  elements.userIdInput.readOnly = true;
  elements.userCompanyInput.value = user.company_name || "";
  elements.userPasswordInput.value = "";
  elements.userRotatePasswordInput.checked = false;
  elements.userStatusInput.value = user.status || "active";
  elements.userDeleteButton.hidden = false;
}

function applyBlankUserForm() {
  elements.userTitle.textContent = "Novo usu\u00e1rio";
  elements.userForm.reset();
  elements.userIdInput.readOnly = false;
  elements.userStatusInput.value = "active";
  elements.userDeleteButton.hidden = true;
  hideUserProvisioningCard();
}

function resetUserForm() {
  state.selectedUserId = null;
  state.userProvisioning = null;
  applyBlankUserForm();
  renderUserSummary(null);
  renderUserList();
}

async function submitUserForm(event) {
  event.preventDefault();

  const payload = {
    user_id: elements.userIdInput.value.trim(),
    company_name: elements.userCompanyInput.value.trim(),
    password: elements.userPasswordInput.value.trim(),
    rotate_password: elements.userRotatePasswordInput.checked,
    status: elements.userStatusInput.value,
  };

  setBanner("Salvando usu\u00e1rio...", "");

  try {
    const response = await fetchJson("/api/developer/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.selectedUserId = response.user.user_id;
    state.userProvisioning = response.provisioning
      ? {
          userId: response.user.user_id,
          password: response.provisioning.password,
          temporary: Boolean(response.provisioning.temporary),
        }
      : null;

    await refreshOverview(`Usu\u00e1rio ${response.user.user_id} salvo.`);
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel salvar o usu\u00e1rio.");
  }
}

async function deleteSelectedUser() {
  const userId = state.selectedUserId;
  if (!userId) {
    setBanner("Escolha um usu\u00e1rio antes de excluir.", "error");
    return;
  }

  const confirmed = window.confirm(`Excluir o usu\u00e1rio ${userId}? Os ESPs ficam sem dono, mas continuam cadastrados.`);
  if (!confirmed) {
    return;
  }

  setBanner(`Excluindo ${userId}...`, "");

  try {
    await fetchJson(`/api/developer/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });

    state.userProvisioning = null;
    resetUserForm();
    await refreshOverview(`Usu\u00e1rio ${userId} exclu\u00eddo.`);
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel excluir o usu\u00e1rio.");
  }
}

function renderUserSummary(user) {
  if (!user) {
    elements.userSummary.innerHTML = `
      <strong>Nenhum usu&aacute;rio selecionado</strong>
      <p>Escolha um cliente para ver os ESPs vinculados e o status da conta.</p>
    `;
    return;
  }

  const deviceBadges = Array.isArray(user.devices) && user.devices.length
    ? user.devices
        .map((device) => `<span class="developer-badge">${escapeHtml(device.name || device.device_id)}</span>`)
        .join("")
    : '<span class="developer-badge">Sem ESP vinculado</span>';

  elements.userSummary.innerHTML = `
    <strong>${escapeHtml(user.company_name || user.user_id)}</strong>
    <div class="developer-summary-list">
      <div class="developer-summary-line"><span>ID</span><strong>${escapeHtml(user.user_id)}</strong></div>
      <div class="developer-summary-line"><span>Acesso</span><strong>${user.password_temporary ? "Senha provis&oacute;ria" : "Senha definitiva"}</strong></div>
      <div class="developer-summary-line"><span>Status</span><strong>${user.status === "active" ? "Ativo" : "Pausado"}</strong></div>
    </div>
    <div class="developer-meta-grid">${deviceBadges}</div>
  `;
}

function renderUserOptions() {
  const ownerValue = elements.deviceOwnerInput.value;
  const targetUserValue = elements.releaseTargetUserInput.value;
  const options = ['<option value="">Sem usu&aacute;rio</option>'];

  for (const user of state.users) {
    options.push(
      `<option value="${escapeHtml(user.user_id)}">${escapeHtml(buildUserLabel(user))}</option>`
    );
  }

  elements.deviceOwnerInput.innerHTML = options.join("");
  if (ownerValue && state.users.some((user) => user.user_id === ownerValue)) {
    elements.deviceOwnerInput.value = ownerValue;
  }

  const targetOptions = ['<option value="">Selecione um usu&aacute;rio</option>'];
  for (const user of state.users) {
    targetOptions.push(
      `<option value="${escapeHtml(user.user_id)}">${escapeHtml(buildUserLabel(user))}</option>`
    );
  }
  elements.releaseTargetUserInput.innerHTML = targetOptions.join("");
  if (targetUserValue && state.users.some((user) => user.user_id === targetUserValue)) {
    elements.releaseTargetUserInput.value = targetUserValue;
  }
}

function renderDeviceList() {
  if (!state.devices.length) {
    elements.deviceList.innerHTML = '<div class="empty-state">Nenhum ESP cadastrado.</div>';
    return;
  }

  elements.deviceList.innerHTML = state.devices
    .map((device) => {
      const isActive = device.device_id === state.selectedDeviceId;
      const online = inferDeviceOnline(device);
      const ownerLabel = device.owner_company_name || "Sem usu\u00e1rio";
      const latestDeployment = device.latest_deployment;
      const deploymentLabel = latestDeployment
        ? `${statusLabel(latestDeployment.status)} ${escapeHtml(latestDeployment.release.version)}`
        : "Sem deploy recente";
      const recoveryLabel = device.pending_device_api_key_last4
        ? `Nova chave ...${escapeHtml(device.pending_device_api_key_last4)}`
        : "";

      return `
        <button
          type="button"
          class="developer-device-card ${isActive ? "active" : ""}"
          data-device-id="${escapeHtml(device.device_id)}"
          aria-pressed="${isActive ? "true" : "false"}"
        >
          <div class="developer-card-top">
            <div>
              <h3 class="developer-card-title">${escapeHtml(device.name || device.device_id)}</h3>
              <p class="developer-card-copy">${escapeHtml(device.device_id)} - ${escapeHtml(ownerLabel)}</p>
            </div>
            <div class="developer-meta-grid">
              ${isActive ? renderSelectionIndicator("Selecionado") : ""}
              <span class="developer-badge ${online ? "developer-badge-success" : ""}">
                ${online ? "Online" : "Sem contato"}
              </span>
            </div>
          </div>
          <div class="developer-card-bottom">
            <span class="developer-badge">${escapeHtml(device.location || "Sem local")}</span>
            <span class="developer-badge">FW ${escapeHtml(device.firmware_version || "--")}</span>
            <span class="developer-badge ${deploymentBadgeClass(latestDeployment?.status)}">${deploymentLabel}</span>
            ${recoveryLabel ? `<span class="developer-badge developer-badge-warning">${recoveryLabel}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  for (const button of elements.deviceList.querySelectorAll("[data-device-id]")) {
    button.addEventListener("click", () => {
      const deviceId = button.dataset.deviceId;
      if (deviceId) {
        loadDeviceDetails(deviceId);
      }
    });
  }
}

function renderSelectedDeviceBanner() {
  if (!elements.selectedDeviceBanner) {
    return;
  }

  const selectedDevice =
    state.devices.find((device) => device.device_id === state.selectedDeviceId) || null;

  if (!selectedDevice) {
    elements.selectedDeviceBanner.innerHTML = `
      <strong>Nenhum ESP selecionado</strong>
      <p>Toque em um card para abrir o ESP e editar os dados dele.</p>
    `;
    return;
  }

  const online = inferDeviceOnline(selectedDevice);
  const pendingKeyLabel = selectedDevice.pending_device_api_key_last4
    ? `Nova chave em espera ...${selectedDevice.pending_device_api_key_last4}`
    : "Sem chave em espera";
  elements.selectedDeviceBanner.innerHTML = `
    <strong>${renderSelectionIndicator("ESP selecionado")} ${escapeHtml(selectedDevice.name || selectedDevice.device_id)}</strong>
    <p>${escapeHtml(selectedDevice.device_id)} - ${escapeHtml(selectedDevice.location || "Sem local")} - ${online ? "online" : "sem contato"} - ${escapeHtml(pendingKeyLabel)}</p>
  `;
}

async function loadDeviceDetails(deviceId, options = {}) {
  if (!options.silent) {
    setBanner(`Carregando ${deviceId}...`, "");
  }

  try {
    const payload = await fetchJson(`/api/developer/devices/${encodeURIComponent(deviceId)}`);
    state.selectedDeviceId = payload.device.device_id;
    fillDeviceForm(payload.device);
    renderDeviceSummary(payload.device);
    renderDeploymentHistory(payload.device.deployments || []);
    renderDeviceList();
    renderSelectedDeviceBanner();
    syncDeviceProvisioningCard();

    if (!options.silent) {
      setBanner(`ESP selecionado: ${payload.device.device_id}.`, "success");
    }
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel abrir o ESP.");
  }
}

function fillDeviceForm(device) {
  elements.deviceTitle.textContent = device.name || device.device_id;
  elements.deviceIdInput.value = device.device_id || "";
  elements.deviceIdInput.readOnly = true;
  elements.deviceNameInput.value = device.name || "";
  elements.deviceOwnerInput.value = device.owner_user_id || "";
  elements.deviceLocationInput.value = device.location || "";
  elements.deviceMenuInput.value = device.location || device.menu_title || "";
  elements.deviceHardwareModelInput.value = device.hardware_model || "lolin_d1_mini";
  elements.deviceFirmwareProfileInput.value = device.firmware_profile || device.device_id;
  elements.devicePollInput.value = String(device.poll_interval_seconds ?? 60);
  elements.deviceUtcOffsetInput.value = String(device.utc_offset_minutes ?? -180);
  elements.deviceSoundInput.checked = Boolean(device.sound_enabled);
  elements.deviceKeyInput.value = "";
  elements.rotateKeyInput.checked = false;
  elements.generateRecoveryKeyButton.hidden = false;
  elements.deviceDeleteButton.hidden = false;
}

function applyBlankDeviceForm() {
  elements.deviceTitle.textContent = "Novo ESP";
  elements.deviceForm.reset();
  elements.deviceIdInput.readOnly = false;
  elements.deviceOwnerInput.value = "";
  elements.deviceMenuInput.value = "";
  elements.deviceHardwareModelInput.value = "lolin_d1_mini";
  elements.deviceFirmwareProfileInput.value = "";
  elements.devicePollInput.value = "60";
  elements.deviceUtcOffsetInput.value = "-180";
  elements.deviceSoundInput.checked = true;
  elements.generateRecoveryKeyButton.hidden = true;
  elements.deviceDeleteButton.hidden = true;
  hideDeviceProvisioningCard();
}

function resetDeviceForm() {
  state.selectedDeviceId = null;
  state.deviceProvisioning = null;
  applyBlankDeviceForm();
  renderDeviceSummary(null);
  renderDeploymentHistory([]);
  renderDeviceList();
  renderSelectedDeviceBanner();
}

async function submitDeviceForm(event) {
  event.preventDefault();
  syncDeviceMenuFromLocation();

  const payload = {
    device_id: elements.deviceIdInput.value.trim(),
    owner_user_id: elements.deviceOwnerInput.value,
    name: elements.deviceNameInput.value.trim(),
    location: elements.deviceLocationInput.value.trim(),
    menu_title: elements.deviceLocationInput.value.trim(),
    hardware_model: elements.deviceHardwareModelInput.value.trim(),
    firmware_profile: elements.deviceFirmwareProfileInput.value.trim(),
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
    state.deviceProvisioning = response.provisioning
      ? {
          deviceId: response.device.device_id,
          deviceApiKey: response.provisioning.device_api_key,
          staged: Boolean(response.provisioning.staged),
        }
      : null;

    await refreshOverview(`ESP ${response.device.device_id} salvo.`);
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel salvar o ESP.");
  }
}

function syncDeviceMenuFromLocation() {
  elements.deviceMenuInput.value = elements.deviceLocationInput.value.trim();
}

async function generateRecoveryKeyForSelectedDevice() {
  const deviceId = state.selectedDeviceId;
  if (!deviceId) {
    setBanner("Escolha um ESP antes de gerar a chave em espera.", "error");
    return;
  }

  setBanner("Gerando chave em espera...", "");

  try {
    const response = await fetchJson(`/api/developer/devices/${encodeURIComponent(deviceId)}/recovery-key`, {
      method: "POST",
    });

    state.selectedDeviceId = response.device.device_id;
    state.deviceProvisioning = response.provisioning
      ? {
          deviceId: response.device.device_id,
          deviceApiKey: response.provisioning.device_api_key,
          staged: Boolean(response.provisioning.staged),
        }
      : null;

    await refreshOverview(`Chave em espera gerada para ${response.device.device_id}.`);
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel gerar a chave em espera.");
  }
}

async function deleteSelectedDevice() {
  const deviceId = state.selectedDeviceId;
  if (!deviceId) {
    setBanner("Escolha um ESP antes de excluir.", "error");
    return;
  }

  const confirmed = window.confirm(`Excluir o ESP ${deviceId}? Isso remove hor\u00e1rios e hist\u00f3rico de deploy ligados a ele.`);
  if (!confirmed) {
    return;
  }

  setBanner(`Excluindo ${deviceId}...`, "");

  try {
    await fetchJson(`/api/developer/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    });

    state.deviceProvisioning = null;
    resetDeviceForm();
    await refreshOverview(`ESP ${deviceId} exclu\u00eddo.`);
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel excluir o ESP.");
  }
}

function renderDeviceSummary(device) {
  if (!device) {
    elements.deviceSummary.innerHTML = `
      <strong>Nenhum ESP selecionado</strong>
      <p>Escolha um dispositivo para ver dono, vers&atilde;o atual e deploys recentes.</p>
    `;
    return;
  }

  const activeSchedules = Array.isArray(device.schedules)
    ? device.schedules.filter((schedule) => schedule.enabled).length
    : numberOrDash(device.active_schedule_count);

  elements.deviceSummary.innerHTML = `
    <strong>${escapeHtml(device.name || device.device_id)}</strong>
    <div class="developer-summary-selection">${renderSelectionIndicator("ESP selecionado")}</div>
    <div class="developer-summary-list">
      <div class="developer-summary-line"><span>ID</span><strong>${escapeHtml(device.device_id)}</strong></div>
      <div class="developer-summary-line"><span>Usu&aacute;rio</span><strong>${escapeHtml(device.owner_company_name || "Sem usu&aacute;rio")}</strong></div>
      <div class="developer-summary-line"><span>Hardware</span><strong>${escapeHtml(device.hardware_model || "--")}</strong></div>
      <div class="developer-summary-line"><span>Perfil</span><strong>${escapeHtml(device.firmware_profile || device.device_id)}</strong></div>
      <div class="developer-summary-line"><span>&Uacute;ltimo contato</span><strong>${formatDateTime(device.last_seen_at)}</strong></div>
      <div class="developer-summary-line"><span>Firmware atual</span><strong>${escapeHtml(device.firmware_version || "--")}</strong></div>
      <div class="developer-summary-line"><span>Hor&aacute;rios ativos</span><strong>${activeSchedules}</strong></div>
      <div class="developer-summary-line"><span>Chave ativa</span><strong>${device.device_api_key_last4 ? `...${escapeHtml(device.device_api_key_last4)}` : "Sem chave"}</strong></div>
      <div class="developer-summary-line"><span>Chave em espera</span><strong>${device.pending_device_api_key_last4 ? `...${escapeHtml(device.pending_device_api_key_last4)}` : "Nenhuma"}</strong></div>
    </div>
    <p class="developer-card-copy developer-card-copy-spaced">
      ${device.pending_device_api_key_last4
        ? "A chave atual continua valendo. Assim que o ESP usar a chave em espera, a troca vira definitiva automaticamente."
        : "Sem troca de chave pendente para este ESP."}
    </p>
  `;
}

function renderDeploymentHistory(deployments) {
  if (!Array.isArray(deployments) || !deployments.length) {
    elements.deploymentHistory.innerHTML = '<div class="empty-state">Nenhum deploy para mostrar.</div>';
    return;
  }

  elements.deploymentHistory.innerHTML = deployments
    .map((deployment) => `
      <article class="developer-release-card">
        <div class="developer-card-top">
          <div>
            <h3 class="developer-card-title">${escapeHtml(deployment.release.version)}</h3>
            <p class="developer-card-copy">${escapeHtml(deployment.release.channel || "stable")} - ${statusLabel(deployment.status)}</p>
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
    `)
    .join("");

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
        handlePortalError(error, "N\u00e3o foi poss\u00edvel cancelar o deploy.");
      }
    });
  }
}

function renderDeviceOptions() {
  const targetValue = elements.releaseTargetDeviceInput.value;
  const options = ['<option value="">Selecione um ESP</option>'];

  for (const device of state.devices) {
    options.push(
      `<option value="${escapeHtml(device.device_id)}">${escapeHtml(buildDeviceLabel(device))}</option>`
    );
  }

  elements.releaseTargetDeviceInput.innerHTML = options.join("");
  if (targetValue && state.devices.some((device) => device.device_id === targetValue)) {
    elements.releaseTargetDeviceInput.value = targetValue;
  }
}

function renderBuildPlanDeviceOptions() {
  const currentValue = elements.buildPlanDeviceInput.value;
  const options = ['<option value="">Selecione um ESP</option>'];

  for (const device of state.devices) {
    options.push(
      `<option value="${escapeHtml(device.device_id)}">${escapeHtml(buildDeviceLabel(device))}</option>`
    );
  }

  elements.buildPlanDeviceInput.innerHTML = options.join("");
  if (currentValue && state.devices.some((device) => device.device_id === currentValue)) {
    elements.buildPlanDeviceInput.value = currentValue;
  } else if (state.selectedDeviceId && state.devices.some((device) => device.device_id === state.selectedDeviceId)) {
    elements.buildPlanDeviceInput.value = state.selectedDeviceId;
  }
}

async function submitBuildPlanForm(event) {
  event.preventDefault();

  const payload = {
    device_id: elements.buildPlanDeviceInput.value,
    version: elements.buildPlanVersionInput.value.trim(),
    channel: elements.buildPlanChannelInput.value.trim() || "stable",
  };

  setBanner("Gerando plano do firmware...", "");

  try {
    const response = await fetchJson("/api/developer/build-plan", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.buildPlan = response.plan;
    elements.buildPlanUseButton.disabled = false;
    renderBuildPlan();
    setBanner(`Plano do ESP ${response.plan.target.device_id} gerado.`, "success");
  } catch (error) {
    state.buildPlan = null;
    elements.buildPlanUseButton.disabled = true;
    renderBuildPlan();
    handlePortalError(error, "N\u00e3o foi poss\u00edvel gerar o plano do firmware.");
  }
}

function renderBuildPlan() {
  if (!state.buildPlan) {
    elements.buildPlanCard.innerHTML = `
      <strong>Nenhum plano gerado</strong>
      <p>Selecione um ESP e uma vers&atilde;o para montar o release_code, o nome do .bin e o comando sugerido.</p>
    `;
    return;
  }

  const plan = state.buildPlan;
  const hasCurrentKey =
    state.deviceProvisioning &&
    state.deviceProvisioning.deviceId === plan.target.device_id &&
    state.deviceProvisioning.deviceApiKey;
  const generatedKeyIsPending = hasCurrentKey && Boolean(state.deviceProvisioning.staged);

  const checklist = Array.isArray(plan.checklist)
    ? plan.checklist.map((item) => `<span class="developer-badge">${escapeHtml(item)}</span>`).join("")
    : "";

  elements.buildPlanCard.innerHTML = `
    <strong>${escapeHtml(plan.release.release_code)}</strong>
    <div class="developer-summary-list">
      <div class="developer-summary-line"><span>ESP</span><strong>${escapeHtml(plan.target.device_id)}</strong></div>
      <div class="developer-summary-line"><span>Bin&aacute;rio</span><strong>${escapeHtml(plan.files.binary_filename)}</strong></div>
      <div class="developer-summary-line"><span>Firmware URL</span><strong>${escapeHtml(plan.files.firmware_url)}</strong></div>
      <div class="developer-summary-line"><span>Sketch</span><strong>${escapeHtml(plan.files.sketch_path)}</strong></div>
      <div class="developer-summary-line"><span>Chave esperada</span><strong>${escapeHtml(plan.target.expected_device_key_last4 ? `...${plan.target.expected_device_key_last4}` : "Sem final salvo")}</strong></div>
    </div>
    ${hasCurrentKey ? `<p class="developer-card-copy developer-card-copy-spaced">${generatedKeyIsPending ? "A chave em espera deste ESP foi gerada nesta sess&atilde;o. Use-a no firmware e a API promove automaticamente no primeiro contato." : "A chave ativa deste ESP foi gerada nesta sess&atilde;o. Use-a no comando abaixo."}</p>` : ""}
    <div class="developer-meta-grid">${checklist}</div>
    <p class="developer-card-copy developer-card-copy-spaced">Comando sugerido</p>
    <pre class="developer-code-block">${escapeHtml(plan.build.powerShell_command)}</pre>
    <p class="developer-card-copy developer-card-copy-spaced">Template de secrets.h</p>
    <pre class="developer-code-block">${escapeHtml(plan.secrets_template)}</pre>
  `;
}

function applyBuildPlanToReleaseForm() {
  if (!state.buildPlan) {
    setBanner("Gere um plano antes de preencher a release.", "error");
    return;
  }

  const release = state.buildPlan.release;
  elements.releaseCodeInput.value = release.release_code || "";
  elements.releaseVersionInput.value = release.version || "";
  elements.releaseChannelInput.value = release.channel || "stable";
  elements.releaseTargetTypeInput.value = release.target_type || "device";
  elements.releaseTargetDeviceInput.value = release.target_device_id || "";
  elements.releaseTargetUserInput.value = "";
  elements.releaseHardwareModelInput.value = release.hardware_model || "";
  elements.releaseBinaryFilenameInput.value = release.binary_filename || "";
  elements.releaseSketchPathInput.value = release.sketch_path || "";
  elements.releaseUrlInput.value = release.firmware_url || "";
  elements.releaseNotesInput.value = release.notes || "";
  updateReleaseTargetFields();
  setBanner("Plano aplicado no formul\u00e1rio de release.", "success");
}

function updateReleaseTargetFields() {
  const targetType = elements.releaseTargetTypeInput.value || "all";
  elements.releaseTargetUserField.hidden = targetType !== "user";
  elements.releaseTargetDeviceField.hidden = targetType !== "device";
}

async function submitReleaseForm(event) {
  event.preventDefault();

  const targetType = elements.releaseTargetTypeInput.value || "all";
  const binaryFilename = elements.releaseBinaryFilenameInput.value.trim();
  const firmwareUrl = elements.releaseUrlInput.value.trim() || (binaryFilename ? `/firmware/${binaryFilename}` : "");
  const payload = {
    release_code: elements.releaseCodeInput.value.trim(),
    version: elements.releaseVersionInput.value.trim(),
    channel: elements.releaseChannelInput.value.trim() || "stable",
    target_type: targetType,
    target_user_id: targetType === "user" ? elements.releaseTargetUserInput.value : undefined,
    target_device_id: targetType === "device" ? elements.releaseTargetDeviceInput.value : undefined,
    hardware_model: elements.releaseHardwareModelInput.value.trim(),
    binary_filename: binaryFilename,
    sketch_path: elements.releaseSketchPathInput.value.trim(),
    firmware_url: firmwareUrl,
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
    await refreshOverview(`Release ${response.release.version} salva.`);
    if (state.selectedReleaseId) {
      elements.releaseSelect.value = String(state.selectedReleaseId);
    }
  } catch (error) {
    handlePortalError(error, "N\u00e3o foi poss\u00edvel salvar a release.");
  }
}

function renderReleaseOptions() {
  const previousValue = elements.releaseSelect.value;
  const options = ['<option value="">Selecione uma release</option>'];

  for (const release of state.releases) {
    options.push(
      `<option value="${release.id}">${escapeHtml(release.version)} - ${escapeHtml(buildReleaseTargetLabel(release))}</option>`
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

  elements.releaseList.innerHTML = state.releases
    .map((release) => `
      <article class="developer-release-card">
        <div class="developer-card-top">
          <div>
            <h3 class="developer-card-title">${escapeHtml(release.version)}</h3>
            <p class="developer-card-copy">${escapeHtml(release.channel || "stable")} - ${escapeHtml(buildReleaseTargetLabel(release))}</p>
          </div>
          <span class="developer-badge ${release.active_deployments ? "developer-badge-warning" : ""}">
            ${release.active_deployments ? `${release.active_deployments} pendente(s)` : "Livre"}
          </span>
        </div>
        <div class="developer-card-bottom">
          <span class="developer-badge">${escapeHtml(release.release_code || "sem-code")}</span>
          <span class="developer-badge">${escapeHtml(release.binary_filename || "sem-bin")}</span>
          <span class="developer-badge">Criada em ${formatDateTime(release.created_at)}</span>
        </div>
        <p class="developer-card-copy developer-card-copy-spaced">${escapeHtml(release.firmware_url || "--")}</p>
        ${release.notes ? `<p class="developer-card-copy developer-card-copy-spaced">${escapeHtml(release.notes)}</p>` : ""}
        <div class="developer-release-actions">
          <button type="button" class="button-secondary" data-pick-release="${release.id}">Usar no deploy</button>
        </div>
      </article>
    `)
    .join("");

  for (const button of elements.releaseList.querySelectorAll("[data-pick-release]")) {
    button.addEventListener("click", () => {
      state.selectedReleaseId = button.dataset.pickRelease;
      renderReleaseOptions();
      elements.releaseSelect.value = String(state.selectedReleaseId);
      setBanner("Release selecionada para o deploy.", "success");
    });
  }
}

async function submitDeploymentForm(event) {
  event.preventDefault();

  const releaseId = elements.releaseSelect.value;
  if (!releaseId) {
    setBanner("Escolha uma release antes de enviar.", "error");
    return;
  }

  const targetMode = elements.deployTargetSelect.value;
  let deviceIds = [];

  if (targetMode === "selected_device") {
    if (!state.selectedDeviceId) {
      setBanner("Selecione um ESP para esse deploy.", "error");
      return;
    }
    deviceIds = [state.selectedDeviceId];
  }

  if (targetMode === "all_devices") {
    deviceIds = state.devices.map((device) => device.device_id);
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
    handlePortalError(error, "N\u00e3o foi poss\u00edvel enviar a OTA.");
  }
}

function showUserProvisioningCard(password) {
  elements.userProvisioningCard.hidden = false;
  elements.userProvisioningValue.textContent = password;
}

function hideUserProvisioningCard() {
  elements.userProvisioningCard.hidden = true;
  elements.userProvisioningTitle.textContent = "Senha provis\u00f3ria gerada";
  elements.userProvisioningValue.textContent = "";
  elements.userProvisioningHint.textContent =
    "Ela come\u00e7a com Haxis- e o usu\u00e1rio precisa trocar essa senha no primeiro login.";
}

function syncUserProvisioningCard() {
  if (
    state.userProvisioning &&
    state.selectedUserId &&
    state.userProvisioning.userId === state.selectedUserId
  ) {
    elements.userProvisioningTitle.textContent = state.userProvisioning.temporary
      ? "Senha provis\u00f3ria gerada"
      : "Senha definida";
    elements.userProvisioningHint.textContent = state.userProvisioning.temporary
      ? "Ela come\u00e7a com Haxis- e o usu\u00e1rio precisa trocar essa senha no primeiro login."
      : "Essa senha foi definida agora e j\u00e1 pode ser usada no painel do cliente.";
    showUserProvisioningCard(state.userProvisioning.password);
    return;
  }

  hideUserProvisioningCard();
}

function showDeviceProvisioningCard(deviceApiKey, options = {}) {
  elements.deviceProvisioningCard.hidden = false;
  elements.deviceProvisioningTitle.textContent = options.staged
    ? "Chave em espera pronta para o firmware"
    : "Chave pronta para o firmware";
  elements.deviceProvisioningValue.textContent = deviceApiKey;
  elements.deviceProvisioningHint.textContent = options.staged
    ? "A chave atual continua funcionando. Grave esta nova chave no ESP e, no primeiro contato com ela, a API conclui a troca automaticamente."
    : "Essa chave j\u00e1 substituiu a anterior no cadastro. Grave-a no firmware antes de reconectar o ESP.";
}

function hideDeviceProvisioningCard() {
  elements.deviceProvisioningCard.hidden = true;
  elements.deviceProvisioningTitle.textContent = "Chave pronta para o firmware";
  elements.deviceProvisioningValue.textContent = "";
  elements.deviceProvisioningHint.textContent = "Use esta chave no firmware do ESP selecionado.";
}

function syncDeviceProvisioningCard() {
  if (
    state.deviceProvisioning &&
    state.selectedDeviceId &&
    state.deviceProvisioning.deviceId === state.selectedDeviceId
  ) {
    showDeviceProvisioningCard(state.deviceProvisioning.deviceApiKey, {
      staged: Boolean(state.deviceProvisioning.staged),
    });
    return;
  }

  hideDeviceProvisioningCard();
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

function handlePortalError(error, fallbackMessage) {
  if (error.status === 401) {
    window.location.replace("/developer/login");
    return;
  }

  console.error(error);
  setBanner(error.message || fallbackMessage, "error");
}

function inferDeviceOnline(device) {
  if (!device?.last_seen_at) {
    return false;
  }

  const lastSeen = new Date(device.last_seen_at);
  if (Number.isNaN(lastSeen.getTime())) {
    return false;
  }

  const toleranceSeconds = Math.max(120, (device.poll_interval_seconds || 60) * 3);
  return Date.now() - lastSeen.getTime() <= toleranceSeconds * 1000;
}

function buildUserLabel(user) {
  return `${user.company_name || user.user_id} (${user.user_id})`;
}

function buildDeviceLabel(device) {
  const owner = device.owner_company_name ? ` - ${device.owner_company_name}` : "";
  return `${device.device_id}${owner}`;
}

function buildReleaseTargetLabel(release) {
  if (release.target_type === "device") {
    return `ESP ${release.target_device_name || release.target_device_id || "--"}`;
  }

  if (release.target_type === "user") {
    return `Usu\u00e1rio ${release.target_user_company_name || release.target_user_id || "--"}`;
  }

  return "Todos os ESPs";
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

function renderSelectionIndicator(label) {
  return `
    <span class="developer-selection-indicator">
      <input class="developer-selection-checkbox" type="checkbox" checked disabled aria-hidden="true">
      <span>${escapeHtml(label)}</span>
    </span>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
