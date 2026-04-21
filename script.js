document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "planner-data";
  const DATA_VERSION = 1;
  const TOAST_DURATION = 5000;
  const SERIES_LOOKAHEAD_DAYS = 120;
  const SUPABASE_TABLE = "planner_state";
  const SUPABASE_ROW_ID = "main";
  const REMOTE_STORAGE_TIMEOUT_MS = 8000;
  const PRIORITIES = ["critical", "important", "normal"];
  const REPEAT_OPTIONS = ["none", "daily", "weekly"];
  const PRIORITY_LABELS = {
    critical: "Критичный",
    important: "Важный",
    normal: "Обычный"
  };
  const REPEAT_LABELS = {
    none: "Без повтора",
    daily: "Ежедневно",
    weekly: "Еженедельно"
  };

  const weekGrid = document.getElementById("week-grid");
  const weekRangeLabel = document.getElementById("week-range-label");
  const weekPrevButton = document.getElementById("week-prev-button");
  const weekNextButton = document.getElementById("week-next-button");
  const selectedDayTitle = document.getElementById("selected-day-title");
  const selectedDayMeta = document.getElementById("selected-day-meta");
  const nextDayTitle = document.getElementById("next-day-title");
  const nextDayMeta = document.getElementById("next-day-meta");
  const nextDayList = document.getElementById("next-day-list");
  const composerDateLabel = document.getElementById("composer-date-label");
  const taskForm = document.getElementById("task-form");
  const taskFormCancel = document.getElementById("task-form-cancel");
  const taskComposerTitle = taskForm?.querySelector(".task-composer__title");
  const taskSubmitButton = taskForm?.querySelector("button[type='submit']");
  const taskTitleInput = document.getElementById("task-title");
  const taskPriorityInput = document.getElementById("task-priority");
  const taskWorkDateInput = document.getElementById("task-work-date");
  const taskDeadlineInput = document.getElementById("task-deadline");
  const taskRepeatInput = document.getElementById("task-repeat");
  const taskCommentInput = document.getElementById("task-comment");
  const taskList = document.getElementById("task-list");
  const exportDataButton = document.getElementById("export-data-button");
  const importDataButton = document.getElementById("import-data-button");
  const importFileInput = document.getElementById("import-file-input");
  const clearCompletedButton = document.getElementById("clear-completed-button");
  const calendarOpenButton = document.getElementById("calendar-open-button");
  const calendarModal = document.getElementById("calendar-modal");
  const calendarMonthLabel = document.getElementById("calendar-month-label");
  const calendarGrid = document.getElementById("calendar-grid");
  const calendarPrevButton = document.getElementById("calendar-prev-button");
  const calendarNextButton = document.getElementById("calendar-next-button");
  const toastContainer = document.getElementById("toast-container");

  if (
    !weekGrid ||
    !weekRangeLabel ||
    !weekPrevButton ||
    !weekNextButton ||
    !selectedDayTitle ||
    !selectedDayMeta ||
    !nextDayTitle ||
    !nextDayMeta ||
    !nextDayList ||
    !composerDateLabel ||
    !taskForm ||
    !taskFormCancel ||
    !taskComposerTitle ||
    !taskSubmitButton ||
    !taskTitleInput ||
    !taskPriorityInput ||
    !taskWorkDateInput ||
    !taskDeadlineInput ||
    !taskRepeatInput ||
    !taskCommentInput ||
    !taskList ||
    !exportDataButton ||
    !importDataButton ||
    !importFileInput ||
    !clearCompletedButton ||
    !calendarOpenButton ||
    !calendarModal ||
    !calendarMonthLabel ||
    !calendarGrid ||
    !calendarPrevButton ||
    !calendarNextButton ||
    !toastContainer
  ) {
    return;
  }

  const today = startOfDay(new Date());
  const pendingDeletions = new Map();
  const focusableCalendarSelectors = "button:not([disabled]), [tabindex]:not([tabindex='-1'])";
  const state = {
    weekStartDate: startOfWeek(today),
    selectedDate: today,
    composerDate: null,
    editingTaskId: null,
    calendar: {
      isOpen: false,
      mode: "navigate",
      taskId: null,
      displayMonth: new Date(today.getFullYear(), today.getMonth(), 1)
    }
  };

  const supabaseConfig = getSupabaseConfig();
  let data = createDefaultData();
  let remoteSaveQueue = Promise.resolve();
  let remoteStorageEnabled = false;
  let isSyncInProgress = false;

  initializeApp();

  function bindEventListeners() {
    weekGrid.addEventListener("click", handleWeekGridClick);
    weekPrevButton.addEventListener("click", () => shiftWeek(-7));
    weekNextButton.addEventListener("click", () => shiftWeek(7));
    taskForm.addEventListener("submit", handleTaskSubmit);
    taskFormCancel.addEventListener("click", () => closeComposer(true));
    taskWorkDateInput.addEventListener("change", handleComposerDateChange);
    taskList.addEventListener("change", handleTaskListChange);
    taskList.addEventListener("click", handleTaskListClick);
    nextDayList.addEventListener("click", handleTaskListClick);
    exportDataButton.addEventListener("click", handleExportDataClick);
    importDataButton.addEventListener("click", handleImportDataClick);
    importFileInput.addEventListener("change", handleImportFileChange);
    clearCompletedButton.addEventListener("click", handleClearCompleted);
    calendarOpenButton.addEventListener("click", () => {
      openCalendar({ mode: "navigate", initialDate: state.selectedDate });
    });
    calendarPrevButton.addEventListener("click", () => updateCalendarMonth(-1));
    calendarNextButton.addEventListener("click", () => updateCalendarMonth(1));
    calendarModal.addEventListener("click", handleCalendarClick);
    document.addEventListener("keydown", handleDocumentKeyDown);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  async function initializeApp() {
    bindEventListeners();

    try {
      data = await loadData();
      carryOverOverdueTasks();
      materializeRecurringTasks();
      await saveData({ awaitRemote: true });
    } catch (error) {
      console.error("Не удалось инициализировать хранилище задач", error);
      data = createDefaultData();
    }

    closeComposer(true);
    renderApp();
  }

  function getSupabaseConfig() {
    const config = window.__PLANNER_CONFIG ?? {};
    const supabaseUrlRaw = typeof config.supabaseUrl === "string" ? config.supabaseUrl.trim() : "";
    const supabaseAnonKey = typeof config.supabaseAnonKey === "string" ? config.supabaseAnonKey.trim() : "";
    const supabaseUrl = supabaseUrlRaw.replace(/\/+$/, "");

    return {
      supabaseUrl,
      supabaseAnonKey,
      enabled: Boolean(supabaseUrl && supabaseAnonKey)
    };
  }

  function getSupabaseRestUrl(query = "") {
    const baseUrl = `${supabaseConfig.supabaseUrl}/rest/v1/${SUPABASE_TABLE}`;
    return query ? `${baseUrl}${query}` : baseUrl;
  }

  function getSupabaseHeaders(extraHeaders = {}) {
    return {
      apikey: supabaseConfig.supabaseAnonKey,
      Authorization: `Bearer ${supabaseConfig.supabaseAnonKey}`,
      ...extraHeaders
    };
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REMOTE_STORAGE_TIMEOUT_MS);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function startOfDay(date) {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);
    return normalizedDate;
  }

  function startOfWeek(date) {
    const normalizedDate = startOfDay(date);
    const day = (normalizedDate.getDay() + 6) % 7;
    return addDays(normalizedDate, -day);
  }

  function addDays(date, days) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + days);
    return startOfDay(nextDate);
  }

  function parseStorageDate(dateValue) {
    if (typeof dateValue !== "string") {
      return startOfDay(new Date(dateValue));
    }

    const [year, month, day] = dateValue.split("-").map(Number);
    if (!year || !month || !day) {
      return startOfDay(new Date(dateValue));
    }

    return new Date(year, month - 1, day);
  }

  function toStorageDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isSameDate(firstDate, secondDate) {
    return firstDate.getTime() === secondDate.getTime();
  }

  function getWeekDates() {
    return Array.from({ length: 7 }, (_, index) => addDays(state.weekStartDate, index));
  }

  function normalizePriority(priority) {
    return PRIORITIES.includes(priority) ? priority : "normal";
  }

  function normalizeRepeat(repeat) {
    return REPEAT_OPTIONS.includes(repeat) ? repeat : "none";
  }

  function createDefaultData() {
    return {
      version: DATA_VERSION,
      tasks: []
    };
  }

  function generateId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createTask(taskData = {}) {
    const createdAt = typeof taskData.createdAt === "string" ? taskData.createdAt : new Date().toISOString();
    const isDone = Boolean(taskData.isDone);
    const completedAt = isDone
      ? (typeof taskData.completedAt === "string" ? taskData.completedAt : createdAt)
      : null;

    return {
      id: typeof taskData.id === "string" && taskData.id.trim() ? taskData.id : generateId("task"),
      text: typeof taskData.text === "string" ? taskData.text.trim() : "",
      priority: normalizePriority(taskData.priority),
      repeat: normalizeRepeat(taskData.repeat),
      seriesId: typeof taskData.seriesId === "string" ? taskData.seriesId : "",
      seriesGeneratedUntil: typeof taskData.seriesGeneratedUntil === "string" ? taskData.seriesGeneratedUntil : "",
      workDate: typeof taskData.workDate === "string" && taskData.workDate
        ? taskData.workDate
        : toStorageDate(state.selectedDate),
      finalDeadline: typeof taskData.finalDeadline === "string" ? taskData.finalDeadline : "",
      comment: typeof taskData.comment === "string" ? taskData.comment.trim() : "",
      isDone,
      isOverdue: Boolean(taskData.isOverdue),
      overdueFromDate: typeof taskData.overdueFromDate === "string" ? taskData.overdueFromDate : "",
      createdAt,
      updatedAt: typeof taskData.updatedAt === "string" ? taskData.updatedAt : createdAt,
      completedAt
    };
  }

  function normalizeData(rawData) {
    const rawTasks = Array.isArray(rawData?.tasks) ? rawData.tasks : [];
    return {
      version: DATA_VERSION,
      tasks: rawTasks.map((task) => createTask(task)).filter((task) => task.text.length > 0)
    };
  }

  function getSnapshotTimestamp(snapshot) {
    const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];

    return tasks.reduce((latestTimestamp, task) => {
      const candidateIso = typeof task.updatedAt === "string" ? task.updatedAt : task.createdAt;
      const candidateTimestamp = Number.isFinite(Date.parse(candidateIso)) ? Date.parse(candidateIso) : 0;
      return candidateTimestamp > latestTimestamp ? candidateTimestamp : latestTimestamp;
    }, 0);
  }

  function loadLocalData() {
    try {
      const savedData = window.localStorage.getItem(STORAGE_KEY);
      if (!savedData) {
        return createDefaultData();
      }

      return normalizeData(JSON.parse(savedData));
    } catch (error) {
      console.error("Не удалось загрузить данные из LocalStorage", error);
      return createDefaultData();
    }
  }

  function saveLocalData(snapshot) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error("Не удалось сохранить данные в LocalStorage", error);
    }
  }

  async function loadRemoteData() {
    if (!supabaseConfig.enabled) {
      throw new Error("Supabase не настроен");
    }

    const response = await fetchWithTimeout(
      getSupabaseRestUrl(`?id=eq.${encodeURIComponent(SUPABASE_ROW_ID)}&select=payload`),
      {
        method: "GET",
        cache: "no-store",
        headers: getSupabaseHeaders({
          Accept: "application/json"
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Supabase вернул статус ${response.status}`);
    }

    const rows = await response.json();
    const payload = Array.isArray(rows) && rows.length > 0 ? rows[0]?.payload : null;

    return normalizeData(payload ?? createDefaultData());
  }

  async function saveRemoteData(snapshot) {
    if (!supabaseConfig.enabled) {
      throw new Error("Supabase не настроен");
    }

    const response = await fetchWithTimeout(
      getSupabaseRestUrl("?on_conflict=id"),
      {
        method: "POST",
        headers: getSupabaseHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        }),
        body: JSON.stringify([
          {
            id: SUPABASE_ROW_ID,
            payload: snapshot
          }
        ])
      }
    );

    if (!response.ok) {
      throw new Error(`Supabase вернул статус ${response.status}`);
    }
  }

  async function loadData() {
    const localData = loadLocalData();

    if (!supabaseConfig.enabled) {
      remoteStorageEnabled = false;
      return localData;
    }

    try {
      const remoteData = await loadRemoteData();
      const hasRemoteTasks = remoteData.tasks.length > 0;
      const hasLocalTasks = localData.tasks.length > 0;

      remoteStorageEnabled = true;

      if (!hasRemoteTasks && hasLocalTasks) {
        await saveRemoteData(localData);
        saveLocalData(localData);
        return localData;
      }

      if (hasRemoteTasks && hasLocalTasks) {
        const localTimestamp = getSnapshotTimestamp(localData);
        const remoteTimestamp = getSnapshotTimestamp(remoteData);

        if (localTimestamp > remoteTimestamp) {
          await saveRemoteData(localData);
          saveLocalData(localData);
          return localData;
        }
      }

      saveLocalData(remoteData);
      return remoteData;
    } catch (error) {
      remoteStorageEnabled = false;
      console.warn("Удаленное хранилище Supabase недоступно, используем LocalStorage", error);
      return localData;
    }
  }

  async function saveData(options = {}) {
    const { awaitRemote = false } = options;
    const normalizedSnapshot = normalizeData(data);
    data = normalizedSnapshot;
    saveLocalData(normalizedSnapshot);

    if (!supabaseConfig.enabled) {
      return;
    }

    const remoteSnapshot = JSON.parse(JSON.stringify(normalizedSnapshot));

    remoteSaveQueue = remoteSaveQueue
      .catch(() => undefined)
      .then(async () => {
        await saveRemoteData(remoteSnapshot);
        remoteStorageEnabled = true;
      })
      .catch((error) => {
        remoteStorageEnabled = false;
        console.warn("Не удалось сохранить задачи в удаленное хранилище Supabase", error);
      });

    if (awaitRemote) {
      await remoteSaveQueue;
    }
  }

  async function syncDataFromRemote() {
    if (!supabaseConfig.enabled || isSyncInProgress || pendingDeletions.size > 0) {
      return;
    }

    isSyncInProgress = true;

    try {
      const remoteData = await loadRemoteData();
      const currentSnapshot = JSON.stringify(normalizeData(data));
      const remoteSnapshot = JSON.stringify(remoteData);

      remoteStorageEnabled = true;

      if (currentSnapshot === remoteSnapshot) {
        return;
      }

      data = remoteData;
      carryOverOverdueTasks();
      materializeRecurringTasks();
      await saveData({ awaitRemote: true });
      renderApp();
    } catch (error) {
      remoteStorageEnabled = false;
      console.warn("Не удалось синхронизировать задачи с Supabase", error);
    } finally {
      isSyncInProgress = false;
    }
  }

  function handleWindowFocus() {
    syncDataFromRemote();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      syncDataFromRemote();
    }
  }

  function carryOverOverdueTasks() {
    const now = new Date().toISOString();

    data.tasks.forEach((task) => {
      if (!task.isOverdue && !task.overdueFromDate) {
        return;
      }

      task.isOverdue = false;
      task.overdueFromDate = "";
      task.updatedAt = now;
    });
  }

  function getTaskById(taskId) {
    return data.tasks.find((task) => task.id === taskId) ?? null;
  }

  function getTasksBySeriesId(seriesId) {
    return data.tasks.filter((task) => task.seriesId === seriesId);
  }

  function cloneTask(task) {
    return JSON.parse(JSON.stringify(task));
  }

  function isTaskPendingDeletion(taskId) {
    for (const deletion of pendingDeletions.values()) {
      if (deletion.taskIds.includes(taskId)) {
        return true;
      }
    }

    return false;
  }

  function getTaskOverdueStartDate(task) {
    if (typeof task.finalDeadline === "string" && task.finalDeadline) {
      return task.finalDeadline;
    }

    if (typeof task.workDate === "string" && task.workDate) {
      return task.workDate;
    }

    return "";
  }

  function isTaskOverdueForDate(task, date) {
    if (task.isDone) {
      return false;
    }

    const storageDate = typeof date === "string" ? date : toStorageDate(startOfDay(date));
    const overdueStartDate = getTaskOverdueStartDate(task);
    if (!overdueStartDate) {
      return false;
    }

    return overdueStartDate < storageDate;
  }

  function toTaskView(task, date) {
    const storageDate = typeof date === "string" ? date : toStorageDate(startOfDay(date));
    const isOverdue = isTaskOverdueForDate(task, storageDate);
    const overdueStartDate = getTaskOverdueStartDate(task);

    return {
      ...task,
      isOverdue,
      overdueFromDate: isOverdue ? overdueStartDate : ""
    };
  }

  function getTasksForDate(date) {
    const storageDate = toStorageDate(date);
    return data.tasks
      .filter((task) => !isTaskPendingDeletion(task.id))
      .filter((task) => {
        if (!task.workDate) {
          return false;
        }

        return task.workDate === storageDate || isTaskOverdueForDate(task, storageDate);
      })
      .map((task) => toTaskView(task, storageDate));
  }

  function sortTasks(tasks) {
    return [...tasks].sort((firstTask, secondTask) => {
      if (firstTask.isOverdue !== secondTask.isOverdue) {
        return Number(secondTask.isOverdue) - Number(firstTask.isOverdue);
      }

      if (firstTask.isDone !== secondTask.isDone) {
        return Number(firstTask.isDone) - Number(secondTask.isDone);
      }

      if (firstTask.isOverdue && secondTask.isOverdue) {
        const firstOverdueDate = firstTask.overdueFromDate || firstTask.workDate;
        const secondOverdueDate = secondTask.overdueFromDate || secondTask.workDate;
        const overdueDiff = firstOverdueDate.localeCompare(secondOverdueDate);
        if (overdueDiff !== 0) {
          return overdueDiff;
        }
      }

      const priorityDiff = PRIORITIES.indexOf(normalizePriority(firstTask.priority)) - PRIORITIES.indexOf(normalizePriority(secondTask.priority));
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return new Date(firstTask.createdAt).getTime() - new Date(secondTask.createdAt).getTime();
    });
  }

  function getNextRecurringDate(task) {
    return addDays(parseStorageDate(task.workDate), task.repeat === "weekly" ? 7 : 1);
  }

  function shiftRecurringDeadline(task, nextWorkDate) {
    if (!task.finalDeadline) {
      return "";
    }

    const currentWorkDate = parseStorageDate(task.workDate);
    const deadlineDate = parseStorageDate(task.finalDeadline);
    const diffDays = Math.round((startOfDay(deadlineDate).getTime() - startOfDay(currentWorkDate).getTime()) / 86400000);
    return toStorageDate(addDays(nextWorkDate, diffDays));
  }

  function getSeriesTemplateTask(seriesTasks) {
    return [...seriesTasks].sort((firstTask, secondTask) => {
      const createdDiff = new Date(firstTask.createdAt).getTime() - new Date(secondTask.createdAt).getTime();
      if (createdDiff !== 0) {
        return createdDiff;
      }

      return firstTask.workDate.localeCompare(secondTask.workDate);
    })[0] ?? null;
  }

  function getSeriesCoverageDate(seriesTasks) {
    let coverageDate = "";

    seriesTasks.forEach((task) => {
      const candidateDate = task.seriesGeneratedUntil || task.workDate;
      if (candidateDate && (!coverageDate || candidateDate > coverageDate)) {
        coverageDate = candidateDate;
      }
    });

    return coverageDate;
  }

  function ensureSeriesCoverage(taskOrSeriesId, untilDate = addDays(today, SERIES_LOOKAHEAD_DAYS)) {
    const seriesId = typeof taskOrSeriesId === "string" ? taskOrSeriesId : taskOrSeriesId?.seriesId;
    if (!seriesId) {
      return false;
    }

    const seriesTasks = getTasksBySeriesId(seriesId).filter((task) => task.repeat !== "none");
    if (seriesTasks.length === 0) {
      return false;
    }

    const prototypeTask = getSeriesTemplateTask(seriesTasks);
    if (!prototypeTask) {
      return false;
    }

    const repeat = normalizeRepeat(prototypeTask.repeat);
    if (repeat === "none") {
      return false;
    }

    const untilStorageDate = toStorageDate(startOfDay(untilDate));
    const storedCoverageDate = getSeriesCoverageDate(seriesTasks) || prototypeTask.workDate;
    const targetCoverageDate = storedCoverageDate > untilStorageDate ? storedCoverageDate : untilStorageDate;
    const now = new Date().toISOString();
    let cursorDate = storedCoverageDate;
    let didChange = false;

    while (cursorDate < targetCoverageDate) {
      const nextDate = addDays(parseStorageDate(cursorDate), repeat === "weekly" ? 7 : 1);
      const nextStorageDate = toStorageDate(nextDate);
      const hasTaskForDate = data.tasks.some((existingTask) => {
        return existingTask.seriesId === seriesId && existingTask.workDate === nextStorageDate;
      });

      if (!hasTaskForDate) {
        data.tasks.push(createTask({
          text: prototypeTask.text,
          priority: prototypeTask.priority,
          repeat,
          seriesId,
          seriesGeneratedUntil: targetCoverageDate,
          workDate: nextStorageDate,
          finalDeadline: shiftRecurringDeadline(prototypeTask, nextDate),
          comment: prototypeTask.comment,
          isDone: false,
          isOverdue: false,
          overdueFromDate: "",
          createdAt: now,
          updatedAt: now,
          completedAt: null
        }));
        didChange = true;
      }

      cursorDate = nextStorageDate;
    }

    data.tasks.forEach((task) => {
      if (task.seriesId !== seriesId || task.repeat === "none") {
        return;
      }

      if (task.seriesGeneratedUntil !== targetCoverageDate) {
        task.seriesGeneratedUntil = targetCoverageDate;
        task.updatedAt = now;
        didChange = true;
      }
    });

    return didChange;
  }

  function materializeRecurringTasks() {
    const recurringSeriesIds = [...new Set(
      data.tasks
        .filter((task) => task.repeat !== "none" && task.seriesId)
        .map((task) => task.seriesId)
    )];

    recurringSeriesIds.forEach((seriesId) => {
      ensureSeriesCoverage(seriesId);
    });
  }

  function ensureNextRecurringTask(task) {
    ensureSeriesCoverage(task);
  }

  function askSeriesScope(promptText) {
    const answer = window.prompt(`${promptText}\n1 - только эту\n2 - всю серию`, "1");
    if (answer === null) {
      return null;
    }

    return answer.trim() === "2" ? "series" : "single";
  }

  function setSelectedDate(nextDate, options = {}) {
    state.selectedDate = startOfDay(nextDate);

    if (options.alignWeek !== false) {
      state.weekStartDate = startOfWeek(state.selectedDate);
    }

    if (!options.keepComposer) {
      closeComposer(false);
    }

    renderApp();
  }

  function shiftWeek(days) {
    state.weekStartDate = addDays(state.weekStartDate, days);
    state.selectedDate = startOfDay(state.weekStartDate);
    closeComposer(false);
    renderApp();
  }

  function resetComposerFormFields() {
    taskForm.reset();
    taskPriorityInput.value = "normal";
    taskRepeatInput.value = "none";
    taskWorkDateInput.value = toStorageDate(state.selectedDate);
    taskDeadlineInput.value = "";
    taskCommentInput.value = "";
  }

  function updateComposerMode() {
    const isEditMode = Boolean(state.editingTaskId);
    taskComposerTitle.textContent = isEditMode ? "Редактирование задачи" : "Новая задача";
    taskSubmitButton.textContent = isEditMode ? "Сохранить изменения" : "Сохранить задачу";
    taskFormCancel.textContent = isEditMode ? "Отмена" : "Скрыть";
  }

  function openComposerForDate(date) {
    state.editingTaskId = null;
    state.selectedDate = startOfDay(date);
    state.weekStartDate = startOfWeek(state.selectedDate);
    state.composerDate = state.selectedDate;
    resetComposerFormFields();
    taskWorkDateInput.value = toStorageDate(state.selectedDate);
    taskForm.hidden = false;
    updateComposerDateLabel();
    updateComposerMode();
    renderApp();
    taskTitleInput.focus();
  }

  function openTaskEditor(taskId) {
    const task = getTaskById(taskId);
    if (!task) {
      return;
    }

    state.editingTaskId = task.id;
    state.composerDate = parseStorageDate(task.workDate);
    taskTitleInput.value = task.text;
    taskPriorityInput.value = normalizePriority(task.priority);
    taskWorkDateInput.value = task.workDate;
    taskDeadlineInput.value = task.finalDeadline;
    taskRepeatInput.value = normalizeRepeat(task.repeat);
    taskCommentInput.value = task.comment;
    taskForm.hidden = false;
    updateComposerDateLabel();
    updateComposerMode();
    renderApp();
    taskTitleInput.focus();
  }

  function closeComposer(resetForm) {
    state.composerDate = null;
    state.editingTaskId = null;
    taskForm.hidden = true;

    if (resetForm) {
      resetComposerFormFields();
    }

    updateComposerMode();
  }

  function updateComposerDateLabel() {
    if (!state.composerDate) {
      composerDateLabel.textContent = "Для выбранного дня";
      return;
    }

    composerDateLabel.textContent = `Для ${formatFullDate(state.composerDate).toLowerCase()}`;
  }

  function handleComposerDateChange() {
    if (!taskWorkDateInput.value) {
      state.composerDate = null;
      updateComposerDateLabel();
      return;
    }

    state.composerDate = parseStorageDate(taskWorkDateInput.value);
    updateComposerDateLabel();
  }

  function createExportPayload() {
    return {
      format: "planner-data-export-v1",
      exportedAt: new Date().toISOString(),
      data: normalizeData(data)
    };
  }

  function triggerJsonDownload(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const objectUrl = window.URL.createObjectURL(blob);
    const tempLink = document.createElement("a");

    tempLink.href = objectUrl;
    tempLink.download = filename;
    document.body.append(tempLink);
    tempLink.click();
    tempLink.remove();
    window.URL.revokeObjectURL(objectUrl);
  }

  function handleExportDataClick() {
    const todayLabel = toStorageDate(startOfDay(new Date()));
    const filename = `planner-export-${todayLabel}.json`;
    triggerJsonDownload(filename, createExportPayload());
  }

  function handleImportDataClick() {
    importFileInput.value = "";
    importFileInput.click();
  }

  function extractImportData(rawPayload) {
    if (rawPayload && typeof rawPayload === "object" && rawPayload.format === "planner-data-export-v1") {
      return normalizeData(rawPayload.data ?? createDefaultData());
    }

    return normalizeData(rawPayload);
  }

  function clearPendingDeletions() {
    for (const pendingDeletion of pendingDeletions.values()) {
      window.clearTimeout(pendingDeletion.timeoutId);
      pendingDeletion.toastElement.remove();
    }

    pendingDeletions.clear();
  }

  async function handleImportFileChange(event) {
    const importedFile = event.target.files?.[0];
    if (!importedFile) {
      return;
    }

    try {
      const fileContent = await importedFile.text();
      const parsedPayload = JSON.parse(fileContent);
      const importedData = extractImportData(parsedPayload);
      const replaceCurrentTasks = window.confirm(
        "Заменить текущие задачи импортированными?\nНажмите ОК, чтобы заменить.\nНажмите Отмена, чтобы объединить списки."
      );

      clearPendingDeletions();

      if (replaceCurrentTasks) {
        data = importedData;
      } else {
        const mergedTasksById = new Map(data.tasks.map((task) => [task.id, cloneTask(task)]));
        importedData.tasks.forEach((task) => {
          mergedTasksById.set(task.id, cloneTask(task));
        });

        data = normalizeData({
          version: DATA_VERSION,
          tasks: [...mergedTasksById.values()]
        });
      }

      carryOverOverdueTasks();
      materializeRecurringTasks();
      await saveData({ awaitRemote: true });
      closeComposer(true);
      renderApp();

      window.alert(`Импорт завершен. Всего задач: ${data.tasks.length}.`);
    } catch (error) {
      console.error("Не удалось импортировать файл задач", error);
      window.alert("Не удалось импортировать файл. Проверьте, что выбран корректный JSON-экспорт планировщика.");
    } finally {
      importFileInput.value = "";
    }
  }

  function handleWeekGridClick(event) {
    const createButton = event.target.closest("[data-day-create]");
    if (createButton) {
      openComposerForDate(parseStorageDate(createButton.dataset.dayCreate));
      return;
    }

    const card = event.target.closest("[data-day-open]");
    if (!card) {
      return;
    }

    setSelectedDate(parseStorageDate(card.dataset.dayOpen));
  }

  function handleTaskSubmit(event) {
    event.preventDefault();

    const text = taskTitleInput.value.trim();
    if (!text) {
      taskTitleInput.focus();
      return;
    }

    const repeat = normalizeRepeat(taskRepeatInput.value);
    const now = new Date().toISOString();
    const workDate = taskWorkDateInput.value || toStorageDate(state.composerDate ?? state.selectedDate);
    if (!workDate) {
      taskWorkDateInput.focus();
      return;
    }

    const editingTask = state.editingTaskId ? getTaskById(state.editingTaskId) : null;

    if (editingTask) {
      const previousRepeat = normalizeRepeat(editingTask.repeat);

      editingTask.text = text;
      editingTask.priority = normalizePriority(taskPriorityInput.value);
      editingTask.repeat = repeat;
      editingTask.workDate = workDate;
      editingTask.finalDeadline = taskDeadlineInput.value;
      editingTask.comment = taskCommentInput.value.trim();
      editingTask.isOverdue = false;
      editingTask.overdueFromDate = "";
      editingTask.updatedAt = now;

      if (repeat === "none") {
        editingTask.seriesId = "";
        editingTask.seriesGeneratedUntil = "";
      } else if (!editingTask.seriesId || previousRepeat === "none") {
        editingTask.seriesId = generateId("series");
        editingTask.seriesGeneratedUntil = "";
      }

      if (repeat !== "none") {
        ensureSeriesCoverage(editingTask);
      }

      saveData();
      closeComposer(true);
      renderApp();
      return;
    }

    const task = createTask({
      text,
      priority: taskPriorityInput.value,
      repeat,
      seriesId: repeat === "none" ? "" : generateId("series"),
      workDate,
      finalDeadline: taskDeadlineInput.value,
      comment: taskCommentInput.value,
      isOverdue: false,
      overdueFromDate: ""
    });

    data.tasks.push(task);
    if (task.repeat !== "none") {
      ensureSeriesCoverage(task);
    }

    saveData();
    closeComposer(true);
    renderApp();
  }

  function handleTaskListChange(event) {
    const checkbox = event.target.closest(".task-item__checkbox");
    if (!checkbox) {
      return;
    }

    const task = getTaskById(checkbox.dataset.taskId);
    if (!task) {
      return;
    }

    const now = new Date().toISOString();
    task.isDone = checkbox.checked;
    task.updatedAt = now;
    task.completedAt = task.isDone ? now : null;

    if (task.isDone) {
      ensureNextRecurringTask(task);
    }

    saveData();
    renderApp();
  }

  function handleTaskListClick(event) {
    const editButton = event.target.closest("[data-task-edit-id]");
    if (editButton) {
      openTaskEditor(editButton.dataset.taskEditId);
      return;
    }

    const moveButton = event.target.closest("[data-task-move-id]");
    if (moveButton) {
      const task = getTaskById(moveButton.dataset.taskMoveId);
      if (!task) {
        return;
      }

      openCalendar({ mode: "move-task", taskId: task.id, initialDate: parseStorageDate(task.workDate) });
      return;
    }

    const deleteButton = event.target.closest("[data-task-delete-id]");
    if (!deleteButton) {
      return;
    }

    const task = getTaskById(deleteButton.dataset.taskDeleteId);
    if (!task) {
      return;
    }

    if (task.repeat !== "none" && task.seriesId) {
      const scope = askSeriesScope("Удалить только эту задачу или всю серию?");
      if (!scope) {
        return;
      }

      if (scope === "series") {
        scheduleDeletion(getTasksBySeriesId(task.seriesId).map((seriesTask) => seriesTask.id), "Серия удалена");
      } else {
        scheduleDeletion([task.id], "Задача удалена");
      }
      return;
    }

    scheduleDeletion([task.id], "Задача удалена");
  }

  function scheduleDeletion(taskIds, message) {
    const uniqueTaskIds = [...new Set(taskIds)].filter((taskId) => Boolean(getTaskById(taskId)) && !isTaskPendingDeletion(taskId));
    if (uniqueTaskIds.length === 0) {
      return;
    }

    const deletionId = generateId("delete");
    const removedTasks = uniqueTaskIds.map((taskId) => cloneTask(getTaskById(taskId))).filter(Boolean);
    const toastElement = createDeletionToast(deletionId, message);
    const timeoutId = window.setTimeout(() => finalizeDeletion(deletionId), TOAST_DURATION);

    pendingDeletions.set(deletionId, {
      taskIds: uniqueTaskIds,
      removedTasks,
      timeoutId,
      toastElement
    });

    toastContainer.prepend(toastElement);
    renderApp();
  }

  function createDeletionToast(deletionId, message) {
    const toastElement = document.createElement("article");
    toastElement.className = "toast";
    toastElement.dataset.deletionId = deletionId;
    toastElement.innerHTML = `
      <div class="toast__content">
        <p class="toast__text">${escapeHtml(message)}</p>
        <button class="toast__undo" type="button">Восстановить</button>
      </div>
      <div class="toast__progress" style="animation-duration: ${TOAST_DURATION}ms;"></div>
    `;

    const undoButton = toastElement.querySelector(".toast__undo");
    undoButton?.addEventListener("click", () => undoDeletion(deletionId));
    return toastElement;
  }

  function undoDeletion(deletionId) {
    const pendingDeletion = pendingDeletions.get(deletionId);
    if (!pendingDeletion) {
      return;
    }

    window.clearTimeout(pendingDeletion.timeoutId);
    pendingDeletion.toastElement.remove();
    pendingDeletions.delete(deletionId);
    renderApp();
  }

  function finalizeDeletion(deletionId) {
    const pendingDeletion = pendingDeletions.get(deletionId);
    if (!pendingDeletion) {
      return;
    }

    const taskIds = new Set(pendingDeletion.taskIds);
    data.tasks = data.tasks.filter((task) => !taskIds.has(task.id));
    saveData();
    pendingDeletion.toastElement.remove();
    pendingDeletions.delete(deletionId);
    renderApp();
  }

  function handleClearCompleted() {
    const selectedTaskIds = getTasksForDate(state.selectedDate)
      .filter((task) => task.isDone)
      .map((task) => task.id);

    if (selectedTaskIds.length === 0) {
      return;
    }

    for (const [deletionId, deletion] of pendingDeletions.entries()) {
      const intersects = deletion.taskIds.some((taskId) => selectedTaskIds.includes(taskId));
      if (!intersects) {
        continue;
      }

      window.clearTimeout(deletion.timeoutId);
      deletion.toastElement.remove();
      pendingDeletions.delete(deletionId);
    }

    const selectedTaskSet = new Set(selectedTaskIds);
    data.tasks = data.tasks.filter((task) => !selectedTaskSet.has(task.id));
    saveData();
    renderApp();
  }

  function handleCalendarClick(event) {
    if (event.target.closest("[data-calendar-close]")) {
      closeCalendar();
      return;
    }

    const dayButton = event.target.closest("[data-calendar-date]");
    if (!dayButton) {
      return;
    }

    applyCalendarDateSelection(parseStorageDate(dayButton.dataset.calendarDate));
  }

  function handleDocumentKeyDown(event) {
    if (!state.calendar.isOpen) {
      return;
    }

    if (event.key === "Escape") {
      closeCalendar();
      return;
    }

    if (event.key === "Tab") {
      trapCalendarFocus(event);
    }
  }

  function openCalendar({ mode, initialDate, taskId = null }) {
    state.calendar.isOpen = true;
    state.calendar.mode = mode;
    state.calendar.taskId = taskId;
    state.calendar.displayMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
    calendarModal.hidden = false;
    renderCalendar();
    calendarModal.querySelector(focusableCalendarSelectors)?.focus();
  }

  function closeCalendar() {
    state.calendar.isOpen = false;
    state.calendar.mode = "navigate";
    state.calendar.taskId = null;
    calendarModal.hidden = true;
  }

  function updateCalendarMonth(offset) {
    state.calendar.displayMonth = new Date(
      state.calendar.displayMonth.getFullYear(),
      state.calendar.displayMonth.getMonth() + offset,
      1
    );
    renderCalendar();
  }

  function renderCalendar() {
    const monthDate = state.calendar.displayMonth;
    const monthLabel = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric"
    }).format(monthDate);

    calendarMonthLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const firstWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    const gridCells = [];

    for (let index = 0; index < firstWeekday; index += 1) {
      gridCells.push('<span class="calendar-day calendar-day--outside" aria-hidden="true"></span>');
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayNumber);
      const storageDate = toStorageDate(date);
      const tasks = getTasksForDate(date);
      const hasRecurring = tasks.some((task) => task.repeat !== "none");
      const hasOverdue = tasks.some((task) => task.isOverdue);
      const isSelected = isSameDate(date, state.selectedDate);
      const isToday = isSameDate(date, today);
      const className = `calendar-day${tasks.length > 0 ? " calendar-day--busy" : ""}${isSelected ? " calendar-day--selected" : ""}${isToday ? " calendar-day--today" : ""}`;
      const markers = tasks.length > 0
        ? `
          <span class="calendar-day__markers" aria-hidden="true">
            <span class="calendar-day__marker"></span>
            ${hasRecurring ? '<span class="calendar-day__marker calendar-day__marker--repeat"></span>' : ""}
            ${hasOverdue ? '<span class="calendar-day__marker calendar-day__marker--overdue"></span>' : ""}
          </span>
        `
        : "";

      gridCells.push(`
        <button
          class="${className}"
          type="button"
          data-calendar-date="${storageDate}"
          aria-label="${formatFullDate(date)}"
        >
          <span class="calendar-day__number">${dayNumber}</span>
          ${markers}
        </button>
      `);
    }

    calendarGrid.innerHTML = gridCells.join("");
  }

  function applyCalendarDateSelection(pickedDate) {
    if (state.calendar.mode === "move-task" && state.calendar.taskId) {
      moveTaskToDate(state.calendar.taskId, pickedDate);
      closeCalendar();
      return;
    }

    closeCalendar();
    setSelectedDate(pickedDate, { alignWeek: true });
  }

  function moveTaskToDate(taskId, nextDate) {
    const task = getTaskById(taskId);
    if (!task) {
      return;
    }

    task.workDate = toStorageDate(startOfDay(nextDate));
    task.isOverdue = false;
    task.overdueFromDate = "";
    task.updatedAt = new Date().toISOString();
    saveData();
    renderApp();
  }

  function trapCalendarFocus(event) {
    const focusableElements = Array.from(calendarModal.querySelectorAll(focusableCalendarSelectors));
    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function formatFullDate(date) {
    const formattedDate = new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);

    return formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
  }

  function formatWeekday(date) {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short" })
      .format(date)
      .replace(".", "")
      .replace(/^./, (value) => value.toUpperCase());
  }

  function formatWeekRange(startDate) {
    const endDate = addDays(startDate, 6);
    const sameMonth = startDate.getMonth() === endDate.getMonth();
    const sameYear = startDate.getFullYear() === endDate.getFullYear();

    if (sameMonth && sameYear) {
      const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(startDate);
      return `${startDate.getDate()} - ${endDate.getDate()} ${monthLabel}`;
    }

    const startLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(startDate);
    const endLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(endDate);
    return `${startLabel} - ${endLabel}`;
  }

  function formatDeadline(dateValue) {
    if (!dateValue) {
      return "Без дедлайна";
    }

    const [year, month, day] = dateValue.split("-");
    return year && month && day ? `${day}.${month}.${year}` : dateValue;
  }

  function formatDayMeta(date) {
    const tasks = getTasksForDate(date);
    if (tasks.length === 0) {
      return "Пока без задач";
    }

    const activeCount = tasks.filter((task) => !task.isDone).length;
    const doneCount = tasks.filter((task) => task.isDone).length;
    return `Активных: ${activeCount}, выполненных: ${doneCount}`;
  }

  function renderWeekGrid() {
    const weekDates = getWeekDates();
    const nextDate = addDays(state.selectedDate, 1);
    weekRangeLabel.textContent = formatWeekRange(state.weekStartDate);
    weekGrid.innerHTML = weekDates.map((date) => {
      const tasks = getTasksForDate(date);
      const overdueCount = tasks.filter((task) => task.isOverdue).length;
      const activeCount = tasks.filter((task) => !task.isDone).length;
      const recurringCount = tasks.filter((task) => task.repeat !== "none").length;
      const isActive = isSameDate(date, state.selectedDate);
      const isToday = isSameDate(date, today);
      const isNext = isSameDate(date, nextDate);

      return `
        <article class="week-card${isActive ? " week-card--active" : ""}${isToday ? " week-card--today" : ""}${isNext ? " week-card--next" : ""}" data-day-open="${toStorageDate(date)}" tabindex="0">
          <div class="week-card__top">
            <span class="week-card__weekday">${formatWeekday(date)}</span>
            <strong class="week-card__day">${date.getDate()}</strong>
            <span class="week-card__month">${new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date)}</span>
          </div>
          <div class="week-card__stats">
            <span class="week-card__stat">Задач: ${tasks.length}</span>
            <span class="week-card__stat">Активных: ${activeCount}</span>
            ${recurringCount > 0 ? `<span class="week-card__stat">Повторы: ${recurringCount}</span>` : ""}
            ${overdueCount > 0 ? `<span class="week-card__stat">Долгов: ${overdueCount}</span>` : ""}
          </div>
          <button class="week-card__create" type="button" data-day-create="${toStorageDate(date)}">Создать задачу</button>
        </article>
      `;
    }).join("");
  }

  function renderSelectedDay() {
    selectedDayTitle.textContent = formatFullDate(state.selectedDate);
    selectedDayMeta.textContent = formatDayMeta(state.selectedDate);
    updateComposerDateLabel();
    updateComposerMode();
    clearCompletedButton.disabled = !getTasksForDate(state.selectedDate).some((task) => task.isDone);
  }

  function renderNextDayStage() {
    const nextDate = addDays(state.selectedDate, 1);
    const tasks = sortTasks(getTasksForDate(nextDate));

    nextDayTitle.textContent = formatFullDate(nextDate);
    nextDayMeta.textContent = tasks.length > 0
      ? formatDayMeta(nextDate)
      : "Следующий день пока свободен. Когда здесь появятся задачи, панель покажет их приглушенным фоном.";

    if (tasks.length === 0) {
      nextDayList.innerHTML = '<p class="task-list__empty next-day-stage__empty">На следующий день задач пока нет.</p>';
      return;
    }

    nextDayList.innerHTML = tasks.map((task) => {
      const metaParts = [];
      if (task.isOverdue && task.overdueFromDate) {
        metaParts.push(`Просрочено с ${formatDeadline(task.overdueFromDate)}`);
      }
      if (task.repeat !== "none") {
        metaParts.push(REPEAT_LABELS[task.repeat]);
      }
      if (task.finalDeadline) {
        metaParts.push(`Дедлайн ${formatDeadline(task.finalDeadline)}`);
      }
      metaParts.push(task.isDone ? "Выполнено" : "Активна");

      return `
        <article class="next-task-item next-task-item--${task.priority}${task.isDone ? " next-task-item--done" : ""}${task.isOverdue ? " next-task-item--overdue" : ""}">
          <div class="next-task-item__main">
            <h3 class="next-task-item__title">${escapeHtml(task.text)}</h3>
            <p class="next-task-item__meta">${escapeHtml(metaParts.join(" • "))}</p>
          </div>
          <div class="next-task-item__side">
            <span class="task-chip task-chip--priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
            <button class="task-edit-button" type="button" data-task-edit-id="${task.id}">Редактировать</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderTaskList() {
    const tasks = sortTasks(getTasksForDate(state.selectedDate));

    if (tasks.length === 0) {
      taskList.innerHTML = '<p class="task-list__empty">Откройте день и создайте задачу кнопкой "Создать задачу" прямо на карточке этого дня.</p>';
      return;
    }

    taskList.innerHTML = tasks.map((task) => {
      const repeatMarkup = task.repeat !== "none"
        ? `<span class="task-chip">${REPEAT_LABELS[task.repeat]}</span>`
        : "";
      const overdueMarkup = task.isOverdue && task.overdueFromDate
        ? `<p class="task-item__overdue">Просрочено с ${escapeHtml(formatDeadline(task.overdueFromDate))}</p>`
        : "";
      const commentMarkup = task.comment
        ? `<p class="task-item__comment">${escapeHtml(task.comment)}</p>`
        : "";

      return `
        <article class="task-item task-item--${task.priority}${task.isDone ? " task-item--done" : ""}${task.isOverdue ? " task-item--overdue" : ""}">
          <div class="task-item__check">
            <input class="task-item__checkbox" type="checkbox" data-task-id="${task.id}" aria-label="Отметить задачу как выполненную" ${task.isDone ? "checked" : ""}>
          </div>
          <div class="task-item__content">
            <h3 class="task-item__title">${escapeHtml(task.text)}</h3>
            ${overdueMarkup}
            ${commentMarkup}
            <div class="task-item__meta">
              <span class="task-chip task-chip--priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
              <span class="task-chip">${escapeHtml(task.finalDeadline ? `Дедлайн: ${formatDeadline(task.finalDeadline)}` : "Без дедлайна")}</span>
              <span class="task-chip">${task.isDone ? "Выполнено" : "Активна"}</span>
              ${repeatMarkup}
            </div>
          </div>
          <div class="task-item__side">
            <span class="task-chip">${escapeHtml(formatFullDate(parseStorageDate(task.workDate)))}</span>
            <div class="task-action-row">
              <button class="task-edit-button" type="button" data-task-edit-id="${task.id}">Редактировать</button>
              <button class="task-move-button" type="button" data-task-move-id="${task.id}">Перенести</button>
              <button class="task-delete-button" type="button" data-task-delete-id="${task.id}">Удалить</button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderApp() {
    renderWeekGrid();
    renderSelectedDay();
    renderNextDayStage();
    renderTaskList();
    renderCalendar();
  }

});














