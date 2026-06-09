const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

const state = {
  apiBaseUrl:
    window.location.origin && window.location.origin.startsWith("http")
      ? window.location.origin
      : "http://localhost:3000",
  session: null,
  requiresPasswordChange: false,
  activeWorkspaceTab: "agenda",
  isScheduleModalOpen: false,
  devices: [],
  deviceSearchTerm: "",
  editingScheduleId: null,
  pendingDeleteScheduleId: null,
  selectedDeviceId: "",
  schedules: [],
};

const elements = {
  apiBadge: document.querySelector("#apiBadge"),
  browserBadge: document.querySelector("#browserBadge"),
  sessionBadge: document.querySelector("#sessionBadge"),
  configHint: document.querySelector("#configHint"),
  loginPanel: document.querySelector("#loginPanel"),
  sessionPanel: document.querySelector("#sessionPanel"),
  passwordChangePanel: document.querySelector("#passwordChangePanel"),
  identifierInput: document.querySelector("#identifierInput"),
  passwordInput: document.querySelector("#passwordInput"),
  loginButton: document.querySelector("#loginButton"),
  passwordChangeForm: document.querySelector("#passwordChangeForm"),
  currentPasswordInput: document.querySelector("#currentPasswordInput"),
  newPasswordInput: document.querySelector("#newPasswordInput"),
  confirmPasswordInput: document.querySelector("#confirmPasswordInput"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  passwordChangeLogoutButton: document.querySelector("#passwordChangeLogoutButton"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  sessionCompanyName: document.querySelector("#sessionCompanyName"),
  sessionMeta: document.querySelector("#sessionMeta"),
  workspaceTabButtons: document.querySelectorAll("[data-workspace-tab]"),
  workspacePanels: document.querySelectorAll("[data-workspace-panel]"),
  accountCompany: document.querySelector("#accountCompany"),
  accountUserId: document.querySelector("#accountUserId"),
  accountAccess: document.querySelector("#accountAccess"),
  accountDeviceCount: document.querySelector("#accountDeviceCount"),
  deviceCardList: document.querySelector("#deviceCardList"),
  deviceSearchInput: document.querySelector("#deviceSearchInput"),
  deviceSelect: document.querySelector("#deviceSelect"),
  deviceStatusText: document.querySelector("#deviceStatusText"),
  flashMessage: document.querySelector("#flashMessage"),
  scheduleCountNote: document.querySelector("#scheduleCountNote"),
  openScheduleModalButton: document.querySelector("#openScheduleModalButton"),
  scheduleEditorPanel: document.querySelector("#scheduleEditorPanel"),
  closeScheduleModalButton: document.querySelector("#closeScheduleModalButton"),
  scheduleEditorBadge: document.querySelector("#scheduleEditorBadge"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleFormKicker: document.querySelector("#scheduleFormKicker"),
  scheduleFormTitle: document.querySelector("#scheduleFormTitle"),
  scheduleFormContext: document.querySelector("#scheduleFormContext"),
  scheduleLabelInput: document.querySelector("#scheduleLabelInput"),
  scheduleHourInput: document.querySelector("#scheduleHourInput"),
  scheduleMinuteInput: document.querySelector("#scheduleMinuteInput"),
  toneHzInput: document.querySelector("#toneHzInput"),
  toneMsInput: document.querySelector("#toneMsInput"),
  repeatCountInput: document.querySelector("#repeatCountInput"),
  repeatGapInput: document.querySelector("#repeatGapInput"),
  enabledInput: document.querySelector("#enabledInput"),
  saveScheduleButton: document.querySelector("#saveScheduleButton"),
  resetScheduleButton: document.querySelector("#resetScheduleButton"),
  scheduleList: document.querySelector("#scheduleList"),
  selectedDeviceHeading: document.querySelector("#selectedDeviceHeading"),
  selectedDeviceContext: document.querySelector("#selectedDeviceContext"),
  summaryConnectionStatus: document.querySelector("#summaryConnectionStatus"),
  summaryTotalSchedules: document.querySelector("#summaryTotalSchedules"),
  summaryActiveSchedules: document.querySelector("#summaryActiveSchedules"),
  summaryNextAlarm: document.querySelector("#summaryNextAlarm"),
  summaryDeviceId: document.querySelector("#summaryDeviceId"),
  summaryName: document.querySelector("#summaryName"),
  summaryLocation: document.querySelector("#summaryLocation"),
  summaryMenuTitle: document.querySelector("#summaryMenuTitle"),
  summaryLastSeen: document.querySelector("#summaryLastSeen"),
  summarySoundEnabled: document.querySelector("#summarySoundEnabled"),
  summaryLocalSound: document.querySelector("#summaryLocalSound"),
  summaryDeviceKey: document.querySelector("#summaryDeviceKey"),
};

bootstrap();

async function bootstrap() {
  updateBrowserStatus();
  window.addEventListener("online", updateBrowserStatus);
  window.addEventListener("offline", updateBrowserStatus);

  elements.loginButton.addEventListener("click", login);
  elements.passwordChangeForm.addEventListener("submit", handlePasswordChange);
  elements.passwordChangeLogoutButton.addEventListener("click", logout);
  elements.refreshButton.addEventListener("click", refreshEverything);
  elements.logoutButton.addEventListener("click", logout);
  elements.workspaceTabButtons.forEach((button) => {
    button.addEventListener("click", handleWorkspaceTabClick);
  });
  elements.deviceSearchInput.addEventListener("input", handleDeviceSearch);
  elements.deviceSelect.addEventListener("change", handleDeviceSelection);
  elements.deviceCardList.addEventListener("click", handleDeviceCardClick);
  elements.openScheduleModalButton.addEventListener("click", handleOpenScheduleModal);
  elements.scheduleEditorPanel.addEventListener("click", handleScheduleModalBackdropClick);
  elements.closeScheduleModalButton.addEventListener("click", handleScheduleModalDismiss);
  elements.scheduleForm.addEventListener("submit", handleScheduleSave);
  elements.resetScheduleButton.addEventListener("click", handleScheduleModalDismiss);
  elements.scheduleList.addEventListener("click", handleScheduleListClick);
  window.addEventListener("keydown", handleGlobalKeydown);
  switchWorkspaceTab(state.activeWorkspaceTab);
  syncScheduleEditorUi();

  const hasSession = await refreshSession({ silent: true });
  if (hasSession) {
    await refreshEverything();
  } else {
    renderLoggedOutState();
  }
}

async function refreshSession(options = {}) {
  try {
    const payload = await apiRequest("/api/client/session", {
      method: "GET",
      allowUnauthorized: true,
    });

    if (!payload?.ok || !payload.user) {
      state.session = null;
      state.requiresPasswordChange = false;
      updateSessionUi();
      return false;
    }

    state.session = payload.user;
    state.requiresPasswordChange = Boolean(payload.requires_password_change);
    updateSessionUi();
    return true;
  } catch (error) {
    if (!options.silent) {
      handleRequestFailure(error, "Nao foi possivel validar sua sessao.");
    }
    state.session = null;
    state.requiresPasswordChange = false;
    updateSessionUi();
    return false;
  }
}

async function login() {
  const identifier = elements.identifierInput.value.trim();
  const password = elements.passwordInput.value.trim();

  if (!identifier || !password) {
    setApiBadge("API: login incompleto", false);
    setHint("Informe seu usuario e tambem a senha.");
    return;
  }

  try {
    setLoadingState("Entrando...");
    const payload = await apiRequest("/api/client/session", {
      method: "POST",
      body: JSON.stringify({
        user_id: identifier,
        password,
      }),
    });

    state.session = payload.user || null;
    state.requiresPasswordChange = Boolean(payload.requires_password_change);
    elements.passwordInput.value = "";
    updateSessionUi();

    if (state.requiresPasswordChange) {
      renderPasswordChangeRequiredState();
      showFlash("Senha provisoria aceita. Troque a senha para liberar a agenda.", "success");
      return;
    }

    await refreshEverything();
    showFlash("Sessao iniciada com sucesso.", "success");
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel entrar com esta conta.");
  }
}

async function logout() {
  try {
    await apiRequest("/api/client/session", {
      method: "DELETE",
      allowUnauthorized: true,
    });
  } catch (error) {
    console.error(error);
  }

  state.session = null;
  state.requiresPasswordChange = false;
  state.devices = [];
  state.selectedDeviceId = "";
  state.schedules = [];
  elements.identifierInput.value = "";
  elements.passwordInput.value = "";
  clearPasswordChangeForm();
  closeScheduleModal();
  renderLoggedOutState();
}

async function handlePasswordChange(event) {
  event.preventDefault();

  const currentPassword = elements.currentPasswordInput.value.trim();
  const newPassword = elements.newPasswordInput.value.trim();
  const confirmPassword = elements.confirmPasswordInput.value.trim();

  if (!currentPassword || !newPassword || !confirmPassword) {
    showFlash("Preencha a senha atual, a nova senha e a confirmacao.", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    showFlash("A confirmacao da nova senha nao confere.", "error");
    return;
  }

  try {
    setLoadingState("Trocando senha...");
    const payload = await apiRequest("/api/client/session/password", {
      method: "PUT",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });

    state.session = payload.user || state.session;
    state.requiresPasswordChange = Boolean(payload.requires_password_change);
    clearPasswordChangeForm();
    updateSessionUi();
    await refreshEverything();
    showFlash("Senha atualizada. A agenda dos ESPs foi liberada.", "success");
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel trocar a senha.");
  }
}

async function refreshEverything() {
  if (!state.session) {
    const hasSession = await refreshSession({ silent: true });
    if (!hasSession) {
      renderLoggedOutState();
      return;
    }
  }

  if (state.requiresPasswordChange) {
    renderPasswordChangeRequiredState();
    return;
  }

  try {
    setLoadingState("Carregando ESPs...");
    const devicesResponse = await apiRequest("/api/client/devices");
    state.devices = Array.isArray(devicesResponse.devices) ? devicesResponse.devices : [];
    updateSessionUi();
    renderDeviceOptions();
    renderDeviceCards();

    if (!state.devices.length) {
      state.selectedDeviceId = "";
      closeScheduleModal();
      renderDeviceSummary(null);
      renderSchedules([]);
      resetScheduleForm();
      setApiBadge("API: online", true);
      setHint("Sua conta ainda nao tem ESPs vinculados.");
      return;
    }

    if (!state.selectedDeviceId || !state.devices.some((device) => device.device_id === state.selectedDeviceId)) {
      state.selectedDeviceId = state.devices[0].device_id;
    }

    elements.deviceSelect.value = state.selectedDeviceId;
    renderDeviceCards();
    await loadSelectedDevice();
    setApiBadge("API: online", true);
    setHint("Conta conectada. Escolha um ESP para editar os horarios.");
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel carregar seus ESPs.");
  }
}

function renderPasswordChangeRequiredState() {
  state.devices = [];
  state.selectedDeviceId = "";
  state.schedules = [];
  closeScheduleModal();
  switchWorkspaceTab("agenda");
  renderDeviceSummary(null);
  renderSchedules([]);
  resetScheduleForm();
  elements.selectedDeviceHeading.textContent = "Troque a senha provisoria";
  elements.selectedDeviceContext.textContent = "Assim que a nova senha for salva, os ESPs da sua conta serao liberados aqui.";
  elements.deviceStatusText.textContent = "Troca de senha pendente";
  elements.deviceCardList.innerHTML =
    '<div class="empty-state">Troque a senha provisoria para liberar os ESPs da sua conta.</div>';
  elements.deviceSelect.innerHTML = '<option value="">Troque a senha primeiro</option>';
  elements.scheduleCountNote.textContent = "Agenda bloqueada ate a troca da senha.";
  elements.scheduleList.innerHTML =
    '<div class="empty-state">Depois de trocar a senha provisoria, os horarios de cada ESP aparecem aqui.</div>';
  setApiBadge("API: senha provisoria", true);
  setHint("Defina uma nova senha para continuar.");
}

function renderLoggedOutState() {
  clearPasswordChangeForm();
  closeScheduleModal();
  switchWorkspaceTab("agenda");
  updateSessionUi();
  renderDeviceSummary(null);
  renderSchedules([]);
  resetScheduleForm();
  elements.deviceStatusText.textContent = "Aguardando login";
  elements.deviceCardList.innerHTML =
    '<div class="empty-state">Entre com sua conta para ver os ESPs liberados para voce.</div>';
  elements.deviceSelect.innerHTML = '<option value="">Entre para ver</option>';
  setApiBadge("API: aguardando login", false);
  setHint("Entre com seu usuario para listar os ESPs vinculados a sua conta.");
  hideFlash();
}

function clearPasswordChangeForm() {
  elements.currentPasswordInput.value = "";
  elements.newPasswordInput.value = "";
  elements.confirmPasswordInput.value = "";
}

function updateSessionUi() {
  const isLoggedIn = Boolean(state.session);
  elements.loginPanel.hidden = isLoggedIn;
  elements.sessionPanel.hidden = !isLoggedIn;
  elements.passwordChangePanel.hidden = !isLoggedIn || !state.requiresPasswordChange;
  document.body.classList.toggle(
    "modal-open",
    (isLoggedIn && state.requiresPasswordChange) || state.isScheduleModalOpen
  );
  elements.sessionBadge.textContent = isLoggedIn
    ? state.requiresPasswordChange
      ? "Sessao: troca pendente"
      : "Sessao: ativa"
    : "Sessao: fechada";
  elements.sessionBadge.classList.toggle("badge-offline", !isLoggedIn || state.requiresPasswordChange);

  if (!isLoggedIn) {
    elements.sessionCompanyName.textContent = "Conta desconectada";
    elements.sessionMeta.textContent = "Entre para editar os horarios dos seus ESPs.";
    elements.accountCompany.textContent = "--";
    elements.accountUserId.textContent = "--";
    elements.accountAccess.textContent = "--";
    elements.accountDeviceCount.textContent = "--";
    return;
  }

  elements.sessionCompanyName.textContent = state.session.company_name || state.session.user_id || "Conta conectada";
  elements.sessionMeta.textContent = state.requiresPasswordChange
    ? "Sua conta entrou com senha provisoria. Troque a senha para liberar os ESPs."
    : `${state.session.user_id} pronto para gerenciar os horarios dos ESPs.`;
  elements.accountCompany.textContent = state.session.company_name || "--";
  elements.accountUserId.textContent = state.session.user_id || "--";
  elements.accountAccess.textContent = state.requiresPasswordChange ? "Senha provisoria" : "Senha definitiva";
  elements.accountDeviceCount.textContent = String(Array.isArray(state.session.devices) ? state.session.devices.length : state.devices.length);

  if (state.requiresPasswordChange) {
    queueMicrotask(() => {
      elements.currentPasswordInput.focus();
    });
  }
}

function handleWorkspaceTabClick(event) {
  const nextTab = event.currentTarget.getAttribute("data-workspace-tab");
  if (!nextTab) {
    return;
  }

  switchWorkspaceTab(nextTab);
}

function handleDeviceSearch(event) {
  state.deviceSearchTerm = String(event.target.value || "").trim().toLowerCase();
  renderDeviceCards();
}

async function handleDeviceSelection(event) {
  if (state.requiresPasswordChange) {
    renderPasswordChangeRequiredState();
    return;
  }

  resetScheduleForm();
  state.selectedDeviceId = event.target.value;
  renderDeviceCards();
  await loadSelectedDevice();
}

async function handleDeviceCardClick(event) {
  if (state.requiresPasswordChange) {
    renderPasswordChangeRequiredState();
    return;
  }

  const button = event.target.closest("[data-device-id]");
  if (!button) {
    return;
  }

  const deviceId = button.getAttribute("data-device-id");
  if (!deviceId || deviceId === state.selectedDeviceId) {
    return;
  }

  resetScheduleForm();
  state.selectedDeviceId = deviceId;
  elements.deviceSelect.value = deviceId;
  renderDeviceCards();
  await loadSelectedDevice();
}

async function loadSelectedDevice() {
  if (state.requiresPasswordChange) {
    renderPasswordChangeRequiredState();
    return;
  }

  if (!state.selectedDeviceId) {
    closeScheduleModal();
    renderDeviceSummary(null);
    renderSchedules([]);
    elements.deviceStatusText.textContent = "Nenhum ESP selecionado";
    return;
  }

  try {
    setLoadingState(`Carregando ${state.selectedDeviceId}...`);
    const deviceResponse = await apiRequest(`/api/client/devices/${encodeURIComponent(state.selectedDeviceId)}`);
    const device = deviceResponse.device || null;
    const schedules = Array.isArray(device?.schedules) ? device.schedules : [];

    if (device) {
      const index = state.devices.findIndex((item) => item.device_id === device.device_id);
      if (index >= 0) {
        state.devices[index] = {
          ...state.devices[index],
          ...device,
          active_schedule_count: schedules.filter((item) => item.enabled).length,
        };
        renderDeviceOptions();
        elements.deviceSelect.value = state.selectedDeviceId;
        renderDeviceCards();
      }
    }

    renderDeviceSummary(device);
    renderSchedules(schedules);
    elements.deviceStatusText.textContent = device ? `ESP ativo: ${device.device_id}` : "ESP nao encontrado";
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel carregar o ESP selecionado.");
  }
}

async function handleScheduleSave(event) {
  event.preventDefault();

  if (state.requiresPasswordChange) {
    showFlash("Troque a senha provisoria antes de editar horarios.", "error");
    return;
  }

  if (!state.selectedDeviceId) {
    showFlash("Selecione um ESP antes de cadastrar horarios.", "error");
    return;
  }

  const selectedDays = getSelectedDays();
  if (!selectedDays.length) {
    showFlash("Escolha pelo menos um dia da semana.", "error");
    return;
  }

  try {
    const payload = {
      label: elements.scheduleLabelInput.value.trim(),
      hour: Number.parseInt(elements.scheduleHourInput.value, 10),
      minute: Number.parseInt(elements.scheduleMinuteInput.value, 10),
      days_of_week: selectedDays,
      tone_hz: Number.parseInt(elements.toneHzInput.value, 10),
      tone_ms: Number.parseInt(elements.toneMsInput.value, 10),
      repeat_count: Number.parseInt(elements.repeatCountInput.value, 10),
      repeat_gap_ms: Number.parseInt(elements.repeatGapInput.value, 10),
      enabled: elements.enabledInput.checked,
    };

    if (state.editingScheduleId === null) {
      setLoadingState("Criando horario...");
      await apiRequest(`/api/client/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      setLoadingState("Atualizando horario...");
      await apiRequest(
        `/api/client/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules/${encodeURIComponent(state.editingScheduleId)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
    }

    await loadSelectedDevice();
    const successMessage =
      state.editingScheduleId === null
        ? `Horario ${payload.label} cadastrado com sucesso.`
        : `Horario ${payload.label} atualizado com sucesso.`;
    resetScheduleForm();
    closeScheduleModal();
    showFlash(successMessage, "success");
  } catch (error) {
    handleRequestFailure(
      error,
      state.editingScheduleId === null
        ? "Nao foi possivel cadastrar o horario."
        : "Nao foi possivel atualizar o horario."
    );
  }
}

async function handleScheduleListClick(event) {
  if (state.requiresPasswordChange) {
    showFlash("Troque a senha provisoria antes de editar horarios.", "error");
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const scheduleId = button.getAttribute("data-schedule-id");
  const action = button.getAttribute("data-action");
  const schedule = findScheduleById(scheduleId);
  const scheduleLabel = schedule?.label || button.getAttribute("data-schedule-label") || "este horario";

  if (!scheduleId || !schedule) {
    return;
  }

  if (action === "edit-schedule") {
    startEditingSchedule(schedule);
    return;
  }

  if (action === "toggle-schedule") {
    await handleScheduleToggle(schedule);
    return;
  }

  if (action !== "delete-schedule") {
    return;
  }

  if (state.pendingDeleteScheduleId !== scheduleId) {
    if (state.editingScheduleId !== null) {
      resetScheduleForm();
    }

    state.pendingDeleteScheduleId = scheduleId;
    renderSchedules(state.schedules);
    showFlash(`Clique novamente para apagar ${scheduleLabel}.`, "error");
    return;
  }

  try {
    setLoadingState("Apagando horario...");
    await apiRequest(
      `/api/client/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: "DELETE",
      }
    );

    state.pendingDeleteScheduleId = null;
    await loadSelectedDevice();
    showFlash(`Horario ${scheduleLabel} removido.`, "success");
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel apagar o horario.");
  }
}

async function handleScheduleToggle(schedule) {
  try {
    const nextEnabled = !schedule.enabled;
    state.pendingDeleteScheduleId = null;
    renderSchedules(state.schedules);

    if (String(state.editingScheduleId) === String(schedule.id)) {
      elements.enabledInput.checked = nextEnabled;
    }

    setLoadingState(nextEnabled ? "Ativando horario..." : "Desativando horario...");
    await apiRequest(
      `/api/client/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules/${encodeURIComponent(schedule.id)}/enabled`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextEnabled }),
      }
    );

    await loadSelectedDevice();
    showFlash(
      nextEnabled
        ? `Horario ${schedule.label} ativado.`
        : `Horario ${schedule.label} desativado.`,
      "success"
    );
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel alterar o estado do horario.");
  }
}

function renderDeviceOptions() {
  if (!state.devices.length) {
    elements.deviceSelect.innerHTML = '<option value="">Nenhum ESP liberado</option>';
    return;
  }

  elements.deviceSelect.innerHTML = state.devices
    .map((device) => {
      const label = [device.device_id, device.name && device.name !== device.device_id ? `- ${device.name}` : ""]
        .filter(Boolean)
        .join(" ");

      return `<option value="${escapeHtml(device.device_id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderDeviceCards() {
  if (!state.devices.length) {
    elements.deviceCardList.innerHTML =
      '<div class="empty-state">Sua conta ainda nao tem ESPs vinculados.</div>';
    return;
  }

  const searchTerm = state.deviceSearchTerm;
  const visibleDevices = state.devices.filter((device) => {
    if (!searchTerm) {
      return true;
    }

    const haystack = [device.device_id, device.name, device.location]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(searchTerm);
  });

  if (!visibleDevices.length) {
    elements.deviceCardList.innerHTML =
      '<div class="empty-state">Nenhum ESP encontrado para esta busca.</div>';
    return;
  }

  elements.deviceCardList.innerHTML = visibleDevices
    .map((device) => {
      const isSelected = device.device_id === state.selectedDeviceId;
      const statusLabel = inferDeviceOnline(device) ? "Online" : "Offline";
      const subtitle = device.location || device.name || "Sem local";
      const keyStatus = device.has_device_api_key
        ? `Chave ...${device.device_api_key_last4 || "----"}`
        : "Sem chave";

      return `
        <button
          type="button"
          class="device-card ${isSelected ? "device-card-selected" : ""}"
          data-device-id="${escapeHtmlAttribute(device.device_id)}"
        >
          <div class="device-card-top">
            <div>
              <strong>${escapeHtml(device.device_id)}</strong>
              <p>${escapeHtml(subtitle)}</p>
            </div>
            <span class="device-status ${inferDeviceOnline(device) ? "device-status-online" : "device-status-offline"}">
              ${statusLabel}
            </span>
          </div>

          <div class="device-card-meta">
            <span>${device.active_schedule_count || 0} ativos</span>
            <span>${keyStatus}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderDeviceSummary(device) {
  if (!device) {
    elements.selectedDeviceHeading.textContent = "Selecione um ESP";
    elements.selectedDeviceContext.textContent = "Escolha um ESP da lista para ver somente os horarios dele.";
    elements.summaryConnectionStatus.textContent = "--";
    elements.summaryTotalSchedules.textContent = "--";
    elements.summaryActiveSchedules.textContent = "--";
    elements.summaryNextAlarm.textContent = "--";
    elements.summaryDeviceId.textContent = "--";
    elements.summaryName.textContent = "--";
    elements.summaryLocation.textContent = "--";
    elements.summaryMenuTitle.textContent = "--";
    elements.summaryLastSeen.textContent = "--";
    elements.summarySoundEnabled.textContent = "--";
    elements.summaryLocalSound.textContent = "--";
    elements.summaryDeviceKey.textContent = "--";
    return;
  }

  const schedules = Array.isArray(device.schedules) ? device.schedules : state.schedules;
  const totalSchedules = schedules.length;
  const activeScheduleCount = schedules.filter((item) => item.enabled).length;
  const nextAlarm = findNextAlarmLabel(schedules);
  const connectionStatus = inferDeviceOnline(device) ? "Online" : "Offline";

  elements.selectedDeviceHeading.textContent = device.menu_title || device.name || device.device_id;
  elements.selectedDeviceContext.textContent = `${device.device_id} selecionado. Os horarios abaixo pertencem somente a ele.`;
  elements.summaryConnectionStatus.textContent = connectionStatus;
  elements.summaryTotalSchedules.textContent = String(totalSchedules);
  elements.summaryActiveSchedules.textContent = String(activeScheduleCount);
  elements.summaryNextAlarm.textContent = nextAlarm;
  elements.summaryDeviceId.textContent = device.device_id || "--";
  elements.summaryName.textContent = device.name || "--";
  elements.summaryLocation.textContent = device.location || "--";
  elements.summaryMenuTitle.textContent = device.menu_title || "--";
  elements.summaryLastSeen.textContent = formatDateTime(device.last_seen_at);
  elements.summarySoundEnabled.textContent = formatBoolean(device.sound_enabled);
  elements.summaryLocalSound.textContent = formatBoolean(device.local_sound_enabled);
  elements.summaryDeviceKey.textContent = formatDeviceKeyStatus(device);
}

function renderSchedules(schedules) {
  state.schedules = schedules;
  const deviceLabel = state.selectedDeviceId || "este ESP";
  elements.scheduleCountNote.textContent = schedules.length
    ? `${schedules.length} horario(s) neste ESP.`
    : `Nenhum horario cadastrado para ${deviceLabel}.`;

  if (
    state.pendingDeleteScheduleId &&
    !schedules.some((schedule) => String(schedule.id) === String(state.pendingDeleteScheduleId))
  ) {
    state.pendingDeleteScheduleId = null;
  }

  if (
    state.editingScheduleId !== null &&
    !schedules.some((schedule) => String(schedule.id) === String(state.editingScheduleId))
  ) {
    resetScheduleForm();
  }

  if (!schedules.length) {
    elements.scheduleList.innerHTML = '<div class="empty-state">Ainda nao existe horario para este ESP.</div>';
    return;
  }

  elements.scheduleList.innerHTML = schedules
    .map((schedule) => {
      const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
      const days = formatDays(schedule.days_of_week);
      const statusClass = schedule.enabled ? "status-pill" : "status-pill status-pill-off";
      const statusLabel = schedule.enabled ? "Ativo" : "Desligado";
      const deleteArmed = String(state.pendingDeleteScheduleId) === String(schedule.id);
      const deleteLabel = deleteArmed ? "Confirmar apagar" : "Apagar";
      const deleteClass = deleteArmed ? "button-danger button-danger-armed" : "button-danger";
      const editClass =
        String(state.editingScheduleId) === String(schedule.id)
          ? "button-secondary button-current"
          : "button-secondary";
      const toggleClass = schedule.enabled ? "button-secondary" : "button-secondary button-attention";
      const toggleLabel = schedule.enabled ? "Desativar" : "Ativar";

      return `
        <article class="schedule-card">
          <div class="schedule-main">
            <div>
              <p class="schedule-time">${time}</p>
              <h3>${escapeHtml(schedule.label)}</h3>
              <p class="schedule-meta">${escapeHtml(days)}</p>
            </div>
            <span class="${statusClass}">${statusLabel}</span>
          </div>

          <div class="schedule-details">
            <span>${schedule.tone_hz} Hz</span>
            <span>${schedule.tone_ms} ms</span>
            <span>${schedule.repeat_count} toque(s)</span>
            <span>gap ${schedule.repeat_gap_ms} ms</span>
          </div>

          <div class="schedule-actions">
            <button
              type="button"
              class="${editClass}"
              data-action="edit-schedule"
              data-schedule-id="${schedule.id}"
            >
              Editar
            </button>
            <button
              type="button"
              class="${toggleClass}"
              data-action="toggle-schedule"
              data-schedule-id="${schedule.id}"
            >
              ${toggleLabel}
            </button>
            <button
              type="button"
              class="${deleteClass}"
              data-action="delete-schedule"
              data-schedule-id="${schedule.id}"
              data-schedule-label="${escapeHtmlAttribute(schedule.label)}"
            >
              ${deleteLabel}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function resetScheduleForm() {
  state.editingScheduleId = null;
  state.pendingDeleteScheduleId = null;
  elements.scheduleLabelInput.value = "";
  elements.scheduleHourInput.value = "8";
  elements.scheduleMinuteInput.value = "0";
  elements.toneHzInput.value = "2400";
  elements.toneMsInput.value = "600";
  elements.repeatCountInput.value = "1";
  elements.repeatGapInput.value = "250";
  elements.enabledInput.checked = true;

  document.querySelectorAll("#dayGrid input[type='checkbox']").forEach((input) => {
    input.checked = ["1", "2", "3", "4", "5"].includes(input.value);
  });

  syncScheduleEditorUi();
}

function startEditingSchedule(schedule) {
  state.editingScheduleId = schedule.id;
  state.pendingDeleteScheduleId = null;

  elements.scheduleLabelInput.value = schedule.label || "";
  elements.scheduleHourInput.value = String(schedule.hour);
  elements.scheduleMinuteInput.value = String(schedule.minute);
  elements.toneHzInput.value = String(schedule.tone_hz);
  elements.toneMsInput.value = String(schedule.tone_ms);
  elements.repeatCountInput.value = String(schedule.repeat_count);
  elements.repeatGapInput.value = String(schedule.repeat_gap_ms);
  elements.enabledInput.checked = Boolean(schedule.enabled);

  const selectedDays = new Set((Array.isArray(schedule.days_of_week) ? schedule.days_of_week : []).map(String));
  document.querySelectorAll("#dayGrid input[type='checkbox']").forEach((input) => {
    input.checked = selectedDays.has(input.value);
  });

  syncScheduleEditorUi(schedule);
  renderSchedules(state.schedules);
  openScheduleModal();
}

function syncScheduleEditorUi(schedule = null) {
  const isEditing = state.editingScheduleId !== null;
  const currentSchedule = schedule || findScheduleById(state.editingScheduleId);
  const deviceLabel = state.selectedDeviceId || "ESP selecionado";

  elements.scheduleFormKicker.textContent = isEditing ? "Editar horario" : "Novo horario";
  elements.scheduleFormTitle.textContent = isEditing ? "Editar horario" : "Cadastrar horario";
  elements.scheduleFormContext.textContent = isEditing
    ? `Atualize o horario selecionado para o ESP ${deviceLabel}.`
    : `Preencha os dados do novo toque para o ESP ${deviceLabel}.`;
  elements.saveScheduleButton.textContent = isEditing ? "Salvar alteracoes" : "Cadastrar horario";
  elements.resetScheduleButton.textContent = isEditing ? "Cancelar edicao" : "Fechar";
  elements.scheduleEditorBadge.textContent = isEditing
    ? `Editando #${currentSchedule?.id ?? state.editingScheduleId}`
    : "Criando";
}

function switchWorkspaceTab(nextTab) {
  state.activeWorkspaceTab = nextTab === "informacoes" ? "informacoes" : "agenda";

  elements.workspaceTabButtons.forEach((button) => {
    const isActive = button.getAttribute("data-workspace-tab") === state.activeWorkspaceTab;
    button.classList.toggle("tab-button-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  elements.workspacePanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-workspace-panel") === state.activeWorkspaceTab;
    panel.hidden = !isActive;
  });
}

function handleOpenScheduleModal() {
  if (state.requiresPasswordChange) {
    showFlash("Troque a senha provisoria antes de editar horarios.", "error");
    return;
  }

  if (!state.selectedDeviceId) {
    showFlash("Selecione um ESP antes de cadastrar horarios.", "error");
    return;
  }

  resetScheduleForm();
  openScheduleModal();
}

function openScheduleModal() {
  state.isScheduleModalOpen = true;
  elements.scheduleEditorPanel.hidden = false;
  updateSessionUi();

  queueMicrotask(() => {
    elements.scheduleLabelInput.focus();
  });
}

function closeScheduleModal() {
  state.isScheduleModalOpen = false;
  elements.scheduleEditorPanel.hidden = true;
  updateSessionUi();
}

function handleScheduleModalDismiss() {
  resetScheduleForm();
  closeScheduleModal();
}

function handleScheduleModalBackdropClick(event) {
  if (event.target !== elements.scheduleEditorPanel) {
    return;
  }

  handleScheduleModalDismiss();
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape" || !state.isScheduleModalOpen) {
    return;
  }

  handleScheduleModalDismiss();
}

function findScheduleById(scheduleId) {
  return state.schedules.find((schedule) => String(schedule.id) === String(scheduleId)) || null;
}

function getSelectedDays() {
  return [...document.querySelectorAll("#dayGrid input[type='checkbox']:checked")]
    .map((input) => Number.parseInt(input.value, 10))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

function setLoadingState(message) {
  elements.deviceStatusText.textContent = message;
  setApiBadge("API: processando", true);
}

function setApiBadge(text, isOnline) {
  elements.apiBadge.textContent = text;
  elements.apiBadge.classList.toggle("badge-offline", !isOnline);
}

function setHint(message) {
  elements.configHint.textContent = message;
}

function showFlash(message, tone) {
  elements.flashMessage.hidden = false;
  elements.flashMessage.textContent = message;
  elements.flashMessage.className = `flash-message flash-${tone}`;
}

function hideFlash() {
  elements.flashMessage.hidden = true;
  elements.flashMessage.textContent = "";
  elements.flashMessage.className = "flash-message";
}

function handleRequestFailure(error, fallbackMessage) {
  console.error(error);

  if (error?.status === 401) {
    state.session = null;
    state.requiresPasswordChange = false;
    renderLoggedOutState();
    showFlash("Sua sessao expirou. Entre novamente.", "error");
    return;
  }

  if (error?.status === 403 && error?.payload?.requires_password_change) {
    state.requiresPasswordChange = true;
    updateSessionUi();
    renderPasswordChangeRequiredState();
    showFlash(error.message || "Troque a senha provisoria para continuar.", "error");
    return;
  }

  const message = error?.message || fallbackMessage;
  setApiBadge("API: erro", false);
  elements.deviceStatusText.textContent = "Falha de comunicacao";
  setHint(message);
  showFlash(message, "error");
}

function updateBrowserStatus() {
  const online = navigator.onLine;
  elements.browserBadge.textContent = `Navegador: ${online ? "online" : "offline"}`;
  elements.browserBadge.classList.toggle("badge-offline", !online);
}

async function apiRequest(path, options = {}) {
  hideFlash();

  const response = await fetch(`${state.apiBaseUrl}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    if (options.allowUnauthorized && response.status === 401) {
      return null;
    }

    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function formatDays(daysOfWeek) {
  if (!Array.isArray(daysOfWeek) || !daysOfWeek.length) {
    return "Sem dias";
  }

  return daysOfWeek
    .map((day) => DAY_LABELS[day] || `Dia ${day}`)
    .join(" - ");
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function formatBoolean(value) {
  if (value === true) {
    return "Ligado";
  }

  if (value === false) {
    return "Desligado";
  }

  return "--";
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

function findNextAlarmLabel(schedules) {
  const next = findNextAlarmOccurrence(schedules);
  if (!next) {
    return "Sem agenda";
  }

  const dayLabel = DAY_LABELS[next.day];
  const hour = String(next.hour).padStart(2, "0");
  const minute = String(next.minute).padStart(2, "0");
  return `${dayLabel} ${hour}:${minute}`;
}

function findNextAlarmOccurrence(schedules) {
  if (!Array.isArray(schedules) || !schedules.length) {
    return null;
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();
  let best = null;

  for (const schedule of schedules) {
    if (!schedule?.enabled || !Array.isArray(schedule.days_of_week)) {
      continue;
    }

    for (const day of schedule.days_of_week) {
      const scheduleMinuteOfDay = Number(schedule.hour) * 60 + Number(schedule.minute);
      let daysAhead = day - currentDay;
      if (daysAhead < 0) {
        daysAhead += 7;
      }
      if (daysAhead === 0 && scheduleMinuteOfDay <= currentMinuteOfDay) {
        daysAhead = 7;
      }

      const score = daysAhead * 1440 + scheduleMinuteOfDay;
      if (!best || score < best.score) {
        best = {
          score,
          day,
          hour: Number(schedule.hour),
          minute: Number(schedule.minute),
        };
      }
    }
  }

  return best;
}

function formatDeviceKeyStatus(device) {
  if (!device) {
    return "--";
  }

  if (!device.has_device_api_key) {
    return "Pendente";
  }

  return device.device_api_key_last4
    ? `Configurada (...${device.device_api_key_last4})`
    : "Configurada";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
