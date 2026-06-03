const STORAGE_KEYS = {
  apiBaseUrl: "scheduler_api_base_url",
};

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

const state = {
  apiBaseUrl: "",
  apiKey: "",
  devices: [],
  deviceSearchTerm: "",
  editingScheduleId: null,
  pendingDeleteScheduleId: null,
  selectedDeviceId: "",
  schedules: [],
};

const elements = {
  apiBadge: document.querySelector("#apiBadge"),
  apiBaseUrlInput: document.querySelector("#apiBaseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  browserBadge: document.querySelector("#browserBadge"),
  configHint: document.querySelector("#configHint"),
  connectButton: document.querySelector("#connectButton"),
  deviceCardList: document.querySelector("#deviceCardList"),
  deviceApiKeyInput: document.querySelector("#deviceApiKeyInput"),
  deviceForm: document.querySelector("#deviceForm"),
  deviceIdInput: document.querySelector("#deviceIdInput"),
  deviceLocationInput: document.querySelector("#deviceLocationInput"),
  deviceMenuTitleInput: document.querySelector("#deviceMenuTitleInput"),
  deviceNameInput: document.querySelector("#deviceNameInput"),
  deviceProvisioningPanel: document.querySelector("#deviceProvisioningPanel"),
  deviceProvisioningValue: document.querySelector("#deviceProvisioningValue"),
  deviceSearchInput: document.querySelector("#deviceSearchInput"),
  deviceSelect: document.querySelector("#deviceSelect"),
  deviceStatusText: document.querySelector("#deviceStatusText"),
  enabledInput: document.querySelector("#enabledInput"),
  flashMessage: document.querySelector("#flashMessage"),
  refreshButton: document.querySelector("#refreshButton"),
  repeatCountInput: document.querySelector("#repeatCountInput"),
  repeatGapInput: document.querySelector("#repeatGapInput"),
  resetScheduleButton: document.querySelector("#resetScheduleButton"),
  saveScheduleButton: document.querySelector("#saveScheduleButton"),
  scheduleCountNote: document.querySelector("#scheduleCountNote"),
  scheduleEditorBadge: document.querySelector("#scheduleEditorBadge"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleHourInput: document.querySelector("#scheduleHourInput"),
  scheduleFormKicker: document.querySelector("#scheduleFormKicker"),
  scheduleLabelInput: document.querySelector("#scheduleLabelInput"),
  scheduleList: document.querySelector("#scheduleList"),
  scheduleMinuteInput: document.querySelector("#scheduleMinuteInput"),
  scheduleFormTitle: document.querySelector("#scheduleFormTitle"),
  summaryActiveSchedules: document.querySelector("#summaryActiveSchedules"),
  summaryConnectionStatus: document.querySelector("#summaryConnectionStatus"),
  summaryDeviceKey: document.querySelector("#summaryDeviceKey"),
  summaryLastSeen: document.querySelector("#summaryLastSeen"),
  summaryLocalSound: document.querySelector("#summaryLocalSound"),
  summaryLocation: document.querySelector("#summaryLocation"),
  summaryName: document.querySelector("#summaryName"),
  summaryNextAlarm: document.querySelector("#summaryNextAlarm"),
  summarySoundEnabled: document.querySelector("#summarySoundEnabled"),
  summaryTotalSchedules: document.querySelector("#summaryTotalSchedules"),
  selectedDeviceContext: document.querySelector("#selectedDeviceContext"),
  selectedDeviceHeading: document.querySelector("#selectedDeviceHeading"),
  toneHzInput: document.querySelector("#toneHzInput"),
  toneMsInput: document.querySelector("#toneMsInput"),
  rotateDeviceApiKeyInput: document.querySelector("#rotateDeviceApiKeyInput"),
  workspaceScopeBadge: document.querySelector("#workspaceScopeBadge"),
};

bootstrap();

function bootstrap() {
  const defaultBaseUrl =
    window.location.origin && window.location.origin.startsWith("http")
      ? window.location.origin
      : "http://localhost:3000";

  state.apiBaseUrl = localStorage.getItem(STORAGE_KEYS.apiBaseUrl) || defaultBaseUrl;
  localStorage.removeItem("scheduler_api_key");
  state.apiKey = "";

  elements.apiBaseUrlInput.value = state.apiBaseUrl;
  elements.apiKeyInput.value = "";

  updateBrowserStatus();
  window.addEventListener("online", updateBrowserStatus);
  window.addEventListener("offline", updateBrowserStatus);

  elements.connectButton.addEventListener("click", handleConnect);
  elements.refreshButton.addEventListener("click", refreshEverything);
  elements.deviceSelect.addEventListener("change", handleDeviceSelection);
  elements.deviceSearchInput.addEventListener("input", handleDeviceSearch);
  elements.deviceForm.addEventListener("submit", handleDeviceSave);
  elements.scheduleForm.addEventListener("submit", handleScheduleSave);
  elements.resetScheduleButton.addEventListener("click", resetScheduleForm);
  elements.scheduleList.addEventListener("click", handleScheduleListClick);
  elements.deviceCardList.addEventListener("click", handleDeviceCardClick);
  syncScheduleEditorUi();

  if (state.apiKey) {
    refreshEverything();
  } else {
    setApiBadge("API: informe a chave", false);
    setHint("Informe a chave da API para continuar.");
  }
}

async function handleConnect() {
  state.apiBaseUrl = normalizeBaseUrl(elements.apiBaseUrlInput.value);
  state.apiKey = elements.apiKeyInput.value.trim();

  if (!state.apiKey) {
    setApiBadge("API: chave ausente", false);
    setHint("A chave da API e obrigatoria.");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.apiBaseUrl, state.apiBaseUrl);
  await refreshEverything();
}

async function refreshEverything() {
  try {
    clearDeviceProvisioning();
    setLoadingState("Carregando devices...");
    const devicesResponse = await apiRequest("/api/devices");
    state.devices = Array.isArray(devicesResponse.devices) ? devicesResponse.devices : [];

    renderDeviceOptions();
    renderDeviceCards();

    if (!state.devices.length) {
      state.selectedDeviceId = "";
      renderDeviceSummary(null);
      renderSchedules([]);
      resetScheduleForm();
      setApiBadge("API: online", true);
      setHint("Nenhum ESP cadastrado ainda.");
      return;
    }

    if (!state.selectedDeviceId || !state.devices.some((device) => device.device_id === state.selectedDeviceId)) {
      state.selectedDeviceId = state.devices[0].device_id;
    }

    elements.deviceSelect.value = state.selectedDeviceId;
    renderDeviceCards();

    await loadSelectedDevice();
    setApiBadge("API: online", true);
    setHint("API conectada.");
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel conectar na API.");
  }
}

async function handleDeviceSelection(event) {
  resetScheduleForm();
  clearDeviceProvisioning();
  state.selectedDeviceId = event.target.value;
  renderDeviceCards();
  await loadSelectedDevice();
}

function handleDeviceSearch(event) {
  state.deviceSearchTerm = String(event.target.value || "").trim().toLowerCase();
  renderDeviceCards();
}

async function handleDeviceCardClick(event) {
  const button = event.target.closest("[data-device-id]");
  if (!button) {
    return;
  }

  const deviceId = button.getAttribute("data-device-id");
  if (!deviceId || deviceId === state.selectedDeviceId) {
    return;
  }

  resetScheduleForm();
  clearDeviceProvisioning();
  state.selectedDeviceId = deviceId;
  elements.deviceSelect.value = deviceId;
  renderDeviceCards();
  await loadSelectedDevice();
}

async function handleDeviceSave(event) {
  event.preventDefault();

  try {
    const payload = {
      device_id: elements.deviceIdInput.value.trim(),
      name: elements.deviceNameInput.value.trim(),
      location: elements.deviceLocationInput.value.trim(),
      menu_title: elements.deviceMenuTitleInput.value.trim(),
      device_api_key: elements.deviceApiKeyInput.value.trim() || undefined,
      rotate_device_api_key: elements.rotateDeviceApiKeyInput.checked,
    };

    setLoadingState("Salvando device...");
    const response = await apiRequest("/api/devices", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const savedDeviceId = response.device?.device_id || payload.device_id;
    state.selectedDeviceId = savedDeviceId;

    await refreshEverything();
    renderDeviceProvisioning(response.provisioning || null, savedDeviceId);
    showFlash(`Device ${savedDeviceId} salvo com sucesso.`, "success");
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel salvar o device.");
  }
}

async function handleScheduleSave(event) {
  event.preventDefault();

  if (!state.selectedDeviceId) {
    showFlash("Selecione ou cadastre um device antes de criar horarios.", "error");
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
      await apiRequest(`/api/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      setLoadingState("Atualizando horario...");
      await apiRequest(
        `/api/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules/${encodeURIComponent(state.editingScheduleId)}`,
        {
        method: "PUT",
        body: JSON.stringify(payload),
        }
      );
    }

    await loadSelectedDevice();
    const successMessage = state.editingScheduleId === null
      ? `Horario ${payload.label} cadastrado com sucesso.`
      : `Horario ${payload.label} atualizado com sucesso.`;
    resetScheduleForm();
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
      `/api/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules/${encodeURIComponent(scheduleId)}`,
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
      `/api/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules/${encodeURIComponent(schedule.id)}/enabled`,
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

async function loadSelectedDevice() {
  if (!state.selectedDeviceId) {
    renderDeviceSummary(null);
    renderSchedules([]);
    elements.deviceStatusText.textContent = "Nenhum ESP selecionado";
    return;
  }

  try {
    setLoadingState(`Carregando ${state.selectedDeviceId}...`);

    const [deviceResponse, schedulesResponse] = await Promise.all([
      apiRequest(`/api/devices/${encodeURIComponent(state.selectedDeviceId)}`),
      apiRequest(`/api/devices/${encodeURIComponent(state.selectedDeviceId)}/schedules`),
    ]);

    const device = deviceResponse.device || null;
    const schedules = Array.isArray(schedulesResponse.schedules) ? schedulesResponse.schedules : [];

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

    if (device) {
      fillDeviceForm(device);
      elements.deviceStatusText.textContent = `Device ativo: ${device.device_id}`;
    }
  } catch (error) {
    handleRequestFailure(error, "Nao foi possivel carregar o device selecionado.");
  }
}

function fillDeviceForm(device) {
  elements.deviceIdInput.value = device.device_id || "";
  elements.deviceNameInput.value = device.name || "";
  elements.deviceLocationInput.value = device.location || "";
  elements.deviceMenuTitleInput.value = device.menu_title || "";
  elements.deviceApiKeyInput.value = "";
  elements.rotateDeviceApiKeyInput.checked = false;
}

function renderDeviceOptions() {
  if (!state.devices.length) {
    elements.deviceSelect.innerHTML = '<option value="">Nenhum ESP cadastrado</option>';
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
      '<div class="empty-state">Nenhum ESP cadastrado.</div>';
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
      '<div class="empty-state">Nenhum ESP encontrado.</div>';
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
    elements.selectedDeviceContext.textContent =
      "Escolha um ESP para ver os horarios dele.";
    elements.workspaceScopeBadge.textContent = "Sem device";
    elements.summaryName.textContent = "--";
    elements.summaryLocation.textContent = "--";
    elements.summaryLastSeen.textContent = "--";
    elements.summaryActiveSchedules.textContent = "--";
    elements.summaryTotalSchedules.textContent = "--";
    elements.summaryConnectionStatus.textContent = "--";
    elements.summaryNextAlarm.textContent = "--";
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
  elements.selectedDeviceContext.textContent =
    `${device.device_id} selecionado. Os horarios abaixo sao so dele.`;
  elements.workspaceScopeBadge.textContent = device.device_id;
  elements.summaryName.textContent = device?.name || "--";
  elements.summaryLocation.textContent = device?.location || "--";
  elements.summaryLastSeen.textContent = formatDateTime(device?.last_seen_at);
  elements.summaryActiveSchedules.textContent = String(activeScheduleCount);
  elements.summaryTotalSchedules.textContent = String(totalSchedules);
  elements.summaryConnectionStatus.textContent = connectionStatus;
  elements.summaryNextAlarm.textContent = nextAlarm;
  elements.summarySoundEnabled.textContent = formatBoolean(device?.sound_enabled);
  elements.summaryLocalSound.textContent = formatBoolean(device?.local_sound_enabled);
  elements.summaryDeviceKey.textContent = formatDeviceKeyStatus(device);
}

function renderSchedules(schedules) {
  state.schedules = schedules;
  const deviceLabel = state.selectedDeviceId || "este device";
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
    elements.scheduleList.innerHTML = '<div class="empty-state">Ainda nao existe horario para este device.</div>';
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
      const editClass = String(state.editingScheduleId) === String(schedule.id)
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
  showFlash(`Editando ${schedule.label}.`, "success");
  elements.scheduleForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncScheduleEditorUi(schedule = null) {
  const isEditing = state.editingScheduleId !== null;
  const currentSchedule = schedule || findScheduleById(state.editingScheduleId);
  const deviceLabel = state.selectedDeviceId || "ESP selecionado";

  elements.scheduleFormKicker.textContent = isEditing ? "Editar horario" : "Novo horario";
  elements.scheduleFormTitle.textContent = isEditing
    ? `Horario do ${deviceLabel}`
    : `Novo horario para ${deviceLabel}`;
  elements.saveScheduleButton.textContent = isEditing ? "Salvar alteracoes" : "Cadastrar horario";
  elements.resetScheduleButton.textContent = isEditing ? "Cancelar edicao" : "Limpar";
  elements.scheduleEditorBadge.hidden = false;
  elements.scheduleEditorBadge.textContent = isEditing
    ? `Editando #${currentSchedule?.id ?? state.editingScheduleId}`
    : "Criando";
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

  if (!state.apiKey) {
    throw new Error("API Key ausente.");
  }

  const response = await fetch(`${state.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": state.apiKey,
      ...(options.headers || {}),
    },
  });

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
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

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
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

function renderDeviceProvisioning(provisioning, deviceId) {
  if (!provisioning?.device_api_key) {
    clearDeviceProvisioning();
    return;
  }

  elements.deviceProvisioningPanel.hidden = false;
  elements.deviceProvisioningValue.textContent = provisioning.device_api_key;
  setHint(
    `Nova chave do device ${deviceId} pronta. Grave-a no firmware como DEVICE_API_KEY e guarde-a fora do navegador.`
  );
}

function clearDeviceProvisioning() {
  elements.deviceProvisioningPanel.hidden = true;
  elements.deviceProvisioningValue.textContent = "";
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
