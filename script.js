document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "planner-data";
  const DATA_VERSION = 1;
  const TOAST_DURATION = 5000;
  const SERIES_LOOKAHEAD_DAYS = 120;
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
  const taskTitleInput = document.getElementById("task-title");
  const taskPriorityInput = document.getElementById("task-priority");
  const taskDeadlineInput = document.getElementById("task-deadline");
  const taskRepeatInput = document.getElementById("task-repeat");
  const taskCommentInput = document.getElementById("task-comment");
  const taskList = document.getElementById("task-list");
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
    !taskTitleInput ||
    !taskPriorityInput ||
    !taskDeadlineInput ||
    !taskRepeatInput ||
    !taskCommentInput ||
    !taskList ||
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
    calendar: {
      isOpen: false,
      mode: "navigate",
      taskId: null,
      displayMonth: new Date(today.getFullYear(), today.getMonth(), 1)
    }
  };

  let data = loadData();
  carryOverOverdueTasks();
  materializeRecurringTasks();
  saveData();

  weekGrid.addEventListener("click", handleWeekGridClick);
  weekPrevButton.addEventListener("click", () => shiftWeek(-7));
  weekNextButton.addEventListener("click", () => shiftWeek(7));
  taskForm.addEventListener("submit", handleTaskSubmit);
  taskFormCancel.addEventListener("click", () => closeComposer(true));
  taskList.addEventListener("change", handleTaskListChange);
  taskList.addEventListener("click", handleTaskListClick);
  taskList.addEventListener("focusin", handleTaskListFocusIn);
  taskList.addEventListener("focusout", handleTaskListFocusOut);
  taskList.addEventListener("keydown", handleTaskListKeyDown);
  clearCompletedButton.addEventListener("click", handleClearCompleted);
  calendarOpenButton.addEventListener("click", () => {
    openCalendar({ mode: "navigate", initialDate: state.selectedDate });
  });
  calendarPrevButton.addEventListener("click", () => updateCalendarMonth(-1));
  calendarNextButton.addEventListener("click", () => updateCalendarMonth(1));
  calendarModal.addEventListener("click", handleCalendarClick);
  document.addEventListener("keydown", handleDocumentKeyDown);

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

  function loadData() {
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

  function saveData() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Не удалось сохранить данные в LocalStorage", error);
    }
  }

  function carryOverOverdueTasks() {
    const todayStorageDate = toStorageDate(today);
    const now = new Date().toISOString();

    data.tasks.forEach((task) => {
      if (task.isDone || !task.workDate || task.workDate >= todayStorageDate) {
        return;
      }

      task.overdueFromDate = task.overdueFromDate || task.workDate;
      task.workDate = todayStorageDate;
      task.isOverdue = true;
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

  function getTasksForDate(date) {
    const storageDate = toStorageDate(date);
    return data.tasks.filter((task) => task.workDate === storageDate && !isTaskPendingDeletion(task.id));
  }

  function sortTasks(tasks) {
    return [...tasks].sort((firstTask, secondTask) => {
      if (firstTask.isDone !== secondTask.isDone) {
        return Number(firstTask.isDone) - Number(secondTask.isDone);
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

  function openComposerForDate(date) {
    state.selectedDate = startOfDay(date);
    state.weekStartDate = startOfWeek(state.selectedDate);
    state.composerDate = state.selectedDate;
    taskForm.hidden = false;
    updateComposerDateLabel();
    renderApp();
    taskTitleInput.focus();
  }

  function closeComposer(resetForm) {
    state.composerDate = null;
    taskForm.hidden = true;

    if (resetForm) {
      taskForm.reset();
      taskPriorityInput.value = "normal";
      taskRepeatInput.value = "none";
    }
  }

  function updateComposerDateLabel() {
    if (!state.composerDate) {
      composerDateLabel.textContent = "Для выбранного дня";
      return;
    }

    composerDateLabel.textContent = `Для ${formatFullDate(state.composerDate).toLowerCase()}`;
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
    const task = createTask({
      text,
      priority: taskPriorityInput.value,
      repeat,
      seriesId: repeat === "none" ? "" : generateId("series"),
      workDate: toStorageDate(state.composerDate ?? state.selectedDate),
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

  function handleTaskListFocusIn(event) {
    const editableTitle = event.target.closest(".task-item__title[contenteditable='true']");
    if (!editableTitle) {
      return;
    }

    editableTitle.dataset.originalText = editableTitle.textContent.trim();
  }

  function handleTaskListFocusOut(event) {
    const editableTitle = event.target.closest(".task-item__title[contenteditable='true']");
    if (!editableTitle) {
      return;
    }

    commitTaskTitleEdit(editableTitle);
  }

  function handleTaskListKeyDown(event) {
    const editableTitle = event.target.closest(".task-item__title[contenteditable='true']");
    if (!editableTitle) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      editableTitle.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      editableTitle.textContent = editableTitle.dataset.originalText ?? editableTitle.textContent;
      editableTitle.blur();
    }
  }

  function commitTaskTitleEdit(editableTitle) {
    const task = getTaskById(editableTitle.dataset.taskId);
    if (!task) {
      return;
    }

    const nextText = editableTitle.textContent.replace(/\s+/g, " ").trim();
    const originalText = editableTitle.dataset.originalText ?? task.text;
    delete editableTitle.dataset.originalText;

    if (!nextText || nextText === originalText || nextText === task.text) {
      editableTitle.textContent = task.text;
      return;
    }

    const now = new Date().toISOString();

    if (task.repeat !== "none" && task.seriesId) {
      const scope = askSeriesScope("Изменить только эту задачу или всю серию?");
      if (!scope) {
        editableTitle.textContent = task.text;
        return;
      }

      if (scope === "series") {
        getTasksBySeriesId(task.seriesId).forEach((seriesTask) => {
          seriesTask.text = nextText;
          seriesTask.updatedAt = now;
        });
      } else {
        task.text = nextText;
        task.updatedAt = now;
      }
    } else {
      task.text = nextText;
      task.updatedAt = now;
    }

    saveData();
    renderApp();
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
        metaParts.push(`Перенесено с ${formatDeadline(task.overdueFromDate)}`);
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
          <span class="task-chip task-chip--priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
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
        ? `<p class="task-item__overdue">Перенесено с ${escapeHtml(formatDeadline(task.overdueFromDate))}</p>`
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
            <h3 class="task-item__title" contenteditable="true" spellcheck="false" data-task-id="${task.id}">${escapeHtml(task.text)}</h3>
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

  closeComposer(true);
  renderApp();
});
