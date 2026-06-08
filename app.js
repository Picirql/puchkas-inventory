// ===================== Config =====================

const PINS = {
  manager: '1234',
  warehouse: '2222',
  shop1: '1111',
  shop2: '3333',
  shop3: '4444',
  kitchen: '5555',
};

const ROLE_LABELS = {
  manager: 'Manager',
  warehouse: 'Warehouse',
  shop1: 'Shop 1',
  shop2: 'Shop 2',
  shop3: 'Shop 3',
  kitchen: 'Kitchen',
};

const ALL_VIEWS = ['items', 'warehouse', 'shop1', 'shop2', 'shop3', 'kitchen'];
const LOCATION_VIEWS = ['kitchen', 'shop1', 'shop2', 'shop3'];

const ROLE_ACCESS = {
  manager: ALL_VIEWS,
  warehouse: ['warehouse'],
  shop1: ['shop1'],
  shop2: ['shop2'],
  shop3: ['shop3'],
  kitchen: ['kitchen'],
};

const SESSION_KEY = 'puchkasInventorySession';
const ITEMS_CATALOG_KEY = 'puchkasItemsCatalog';
const LOCATION_STOCKS_KEY = 'puchkasLocationStocks';
const LOCATION_LOGS_KEY = 'puchkasLocationLogs';
const WAREHOUSE_REQUESTS_KEY = 'puchkasWarehouseRequests';
const KITCHEN_REQUESTS_KEY = 'puchkasKitchenRequests';

// ===================== State =====================

let selectedRole = null;
let enteredPin = [];
let pendingRemoval = null;
let pendingEdit = null;
let pendingPartialDispatch = null;
let currentViewKey = null;

let itemsCatalog = loadItemsCatalog() || {
  raw: ['Potato', 'Maida', 'Oil', 'Spices'],
  processed: ['Puchka Shells', 'Sweet Water', 'Spicy Water', 'Masala Mix'],
};

let activeWarehouseSubtab = 'general';
let activeLocationSubtab = 'general';

// Tracks which location's stock/logs the currently-rendered inventory
// dashboard (Warehouse > General Inventory, or a location's own General
// Inventory) is showing — every search/update/export operates on this.
let activeInventoryLocation = 'warehouse';

// Stocks and logs are partitioned per location so that updates made for one
// location (e.g. Kitchen) never bleed into another's (e.g. Shop 1) numbers.
let locationStocks = loadLocationStocks() || buildDefaultLocationStocks();
let locationLogs = loadLocationLogs() || buildDefaultLocationLogs();

// Elements: { id, timestamp, fromLocation, item, qty, status: 'Pending' | 'Dispatched' | 'Received' }
let warehouseRequests = loadWarehouseRequests() || [];

// Requests made by the Warehouse to the Kitchen (the reverse direction of warehouseRequests).
// Elements: { id, timestamp, item, qty, status: 'Pending' | 'Dispatched' | 'Rejected' }
let kitchenRequests = loadKitchenRequests() || [];

// ===================== DOM References =====================

const loginScreen = document.getElementById('login-screen');
const appShell = document.getElementById('app-shell');

const roleCards = document.querySelectorAll('.role-card');

const pinOverlay = document.getElementById('pin-overlay');
const pinRoleName = document.getElementById('pin-role-name');
const pinDisplay = document.getElementById('pin-display');
const pinDots = document.querySelectorAll('.pin-dot');
const pinError = document.getElementById('pin-error');
const pinCancelBtn = document.getElementById('pin-cancel-btn');
const keypadButtons = document.querySelectorAll('.key');

const loggedInRoleLabel = document.getElementById('logged-in-role');
const logoutBtn = document.getElementById('logout-btn');
const navButtons = document.querySelectorAll('.nav-btn');
const viewContent = document.getElementById('view-content');

const warehouseView = document.getElementById('warehouse-view');
const warehouseSubtabButtons = document.querySelectorAll('.warehouse-subtab-btn');
const warehouseSubtabContent = document.getElementById('warehouse-subtab-content');

const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = document.getElementById('confirm-message');
const confirmRemoveBtn = document.getElementById('confirm-remove-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

const stockModal = document.getElementById('stock-modal');
const stockItemSearch = document.getElementById('stock-item-search');
const stockItemSuggestions = document.getElementById('stock-item-suggestions');
const stockActionSelect = document.getElementById('stock-action-select');
const stockQuantityInput = document.getElementById('stock-quantity-input');
const stockModalError = document.getElementById('stock-modal-error');
const stockSaveBtn = document.getElementById('stock-save-btn');
const stockCancelBtn = document.getElementById('stock-cancel-btn');

const editItemModal = document.getElementById('edit-item-modal');
const editItemInput = document.getElementById('edit-item-input');
const editItemError = document.getElementById('edit-item-error');
const editItemSaveBtn = document.getElementById('edit-item-save-btn');
const editItemCancelBtn = document.getElementById('edit-item-cancel-btn');

const partialDispatchModal = document.getElementById('partial-dispatch-modal');
const partialDispatchInfo = document.getElementById('partial-dispatch-info');
const partialDispatchQtyInput = document.getElementById('partial-dispatch-qty-input');
const partialDispatchError = document.getElementById('partial-dispatch-error');
const partialDispatchSendBtn = document.getElementById('partial-dispatch-send-btn');
const partialDispatchCancelBtn = document.getElementById('partial-dispatch-cancel-btn');

const hamburgerBtn = document.getElementById('hamburger-btn');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

// ===================== PIN Pad =====================

function openPinPad(role) {
  selectedRole = role;
  enteredPin = [];
  pinRoleName.textContent = ROLE_LABELS[role] || role;
  pinError.hidden = true;
  updatePinDisplay();
  pinOverlay.hidden = false;
}

function closePinPad() {
  pinOverlay.hidden = true;
  selectedRole = null;
  enteredPin = [];
  pinError.hidden = true;
  updatePinDisplay();
}

function updatePinDisplay() {
  pinDots.forEach((dot, index) => {
    dot.classList.toggle('filled', index < enteredPin.length);
  });
}

function handleKeyPress(key) {
  if (key === 'clear') {
    enteredPin = [];
    updatePinDisplay();
    return;
  }

  if (key === 'backspace') {
    enteredPin.pop();
    updatePinDisplay();
    return;
  }

  if (enteredPin.length < 4) {
    enteredPin.push(key);
    updatePinDisplay();
  }

  if (enteredPin.length === 4) {
    validatePin();
  }
}

function validatePin() {
  const code = enteredPin.join('');

  if (code === PINS[selectedRole]) {
    const role = selectedRole;
    saveSession(role);
    closePinPad();
    enterApp(role);
  } else {
    pinDisplay.classList.add('shake');
    pinError.hidden = false;

    setTimeout(() => {
      pinDisplay.classList.remove('shake');
      enteredPin = [];
      updatePinDisplay();
    }, 400);
  }
}

// ===================== Session =====================

function saveSession(role) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ role }));
}

function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function saveItemsCatalog() {
  localStorage.setItem(ITEMS_CATALOG_KEY, JSON.stringify(itemsCatalog));
}

function loadItemsCatalog() {
  const raw = localStorage.getItem(ITEMS_CATALOG_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function buildDefaultLocationStocks() {
  return {
    warehouse: {},
    kitchen: {},
    shop1: {},
    shop2: {},
    shop3: {},
  };
}

function buildDefaultLocationLogs() {
  return {
    warehouse: [],
    kitchen: [],
    shop1: [],
    shop2: [],
    shop3: [],
  };
}

function saveLocationStocks() {
  localStorage.setItem(LOCATION_STOCKS_KEY, JSON.stringify(locationStocks));
}

function loadLocationStocks() {
  const raw = localStorage.getItem(LOCATION_STOCKS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveLocationLogs() {
  localStorage.setItem(LOCATION_LOGS_KEY, JSON.stringify(locationLogs));
}

function loadLocationLogs() {
  const raw = localStorage.getItem(LOCATION_LOGS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveWarehouseRequests() {
  localStorage.setItem(WAREHOUSE_REQUESTS_KEY, JSON.stringify(warehouseRequests));
}

function loadWarehouseRequests() {
  const raw = localStorage.getItem(WAREHOUSE_REQUESTS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveKitchenRequests() {
  localStorage.setItem(KITCHEN_REQUESTS_KEY, JSON.stringify(kitchenRequests));
}

function loadKitchenRequests() {
  const raw = localStorage.getItem(KITCHEN_REQUESTS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ===================== App Shell / Views =====================

function enterApp(role) {
  loginScreen.style.display = 'none';
  appShell.style.display = 'flex';

  loggedInRoleLabel.textContent = ROLE_LABELS[role] || role;

  const allowedViews = applyRoleAccess(role);
  if (allowedViews.length) {
    renderView(allowedViews[0]);
  }
}

function applyRoleAccess(role) {
  const allowedViews = ROLE_ACCESS[role] || [];

  navButtons.forEach((btn) => {
    const allowed = allowedViews.includes(btn.dataset.view);
    btn.parentElement.hidden = !allowed;
  });

  return allowedViews;
}

function renderView(viewKey) {
  currentViewKey = viewKey;

  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewKey);
  });

  const isWarehouse = viewKey === 'warehouse';
  viewContent.hidden = isWarehouse;
  warehouseView.hidden = !isWarehouse;

  viewContent.classList.toggle('is-bare', viewKey === 'items');
  viewContent.classList.toggle('is-wide', LOCATION_VIEWS.includes(viewKey));

  if (viewKey === 'items') {
    renderItemsView();
  } else if (isWarehouse) {
    renderWarehouseView();
  } else if (LOCATION_VIEWS.includes(viewKey)) {
    renderLocationView(viewKey);
  } else {
    const label = ROLE_LABELS[viewKey] || viewKey;
    viewContent.innerHTML = `<p>Welcome to the ${label} view</p>`;
  }

  closeSidebarDrawer();
}

const ITEM_CATEGORIES = [
  { key: 'raw', label: 'Raw Items' },
  { key: 'processed', label: 'Processed Items' },
];

const WAREHOUSE_SUBTAB_LABELS = {
  general: 'General Inventory',
  kitchen: 'Kitchen',
  shop1: 'Shop 1',
  shop2: 'Shop 2',
  shop3: 'Shop 3',
};

// "General Inventory" is the warehouse's own stock, so it maps to the
// 'warehouse' partition in locationStocks/locationLogs; the other subtabs
// map 1:1 onto their location keys.
const WAREHOUSE_SUBTAB_LOCATIONS = {
  general: 'warehouse',
  kitchen: 'kitchen',
  shop1: 'shop1',
  shop2: 'shop2',
  shop3: 'shop3',
};

function getActiveLocationKey() {
  return WAREHOUSE_SUBTAB_LOCATIONS[activeWarehouseSubtab] || activeWarehouseSubtab;
}

function renderItemsView() {
  viewContent.innerHTML = `
    <div class="items-dashboard">
      ${ITEM_CATEGORIES.map((category) => `
        <section class="items-card">
          <h3 class="items-card-title">${category.label}</h3>

          <input type="text" class="items-search-input" placeholder="Search ${category.label.toLowerCase()}..." data-category="${category.key}" autocomplete="off" />

          <form class="add-item-form" data-category="${category.key}">
            <input type="text" class="add-item-input" placeholder="New item name" autocomplete="off" />
            <button type="submit" class="add-item-btn">+ Add Item</button>
          </form>

          ${itemsCatalog[category.key].length
            ? `<ol class="item-list">
                ${itemsCatalog[category.key]
                  .map((item, index) => `
                    <li class="item-row">
                      <span class="item-index">${index + 1}</span>
                      <span class="item-name">${escapeHtml(item)}</span>
                      <button type="button" class="item-edit-btn" data-category="${category.key}" data-index="${index}">Edit</button>
                      <button type="button" class="item-remove-btn" data-category="${category.key}" data-index="${index}">Remove</button>
                    </li>
                  `)
                  .join('')}
              </ol>`
            : `<p class="empty-list-msg">No items yet — add one above.</p>`}
        </section>
      `).join('')}
    </div>
  `;

  viewContent.querySelectorAll('.add-item-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleAddItem(form);
    });
  });

  viewContent.querySelectorAll('.item-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleEditItem(btn.dataset.category, Number(btn.dataset.index));
    });
  });

  viewContent.querySelectorAll('.item-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleRemoveItem(btn.dataset.category, Number(btn.dataset.index));
    });
  });

  viewContent.querySelectorAll('.items-search-input').forEach((input) => {
    input.addEventListener('input', () => {
      filterCategoryRows(input);
    });
  });
}

function filterCategoryRows(searchInput) {
  const query = searchInput.value.trim().toLowerCase();
  const card = searchInput.closest('.items-card');

  card.querySelectorAll('.item-row').forEach((row) => {
    const name = row.querySelector('.item-name').textContent.toLowerCase();
    row.hidden = query.length > 0 && !name.includes(query);
  });
}

function handleAddItem(form) {
  const category = form.dataset.category;
  const input = form.querySelector('.add-item-input');
  const name = input.value.trim();

  if (!name) return;

  const isDuplicate = itemsCatalog[category].some(
    (item) => item.toLowerCase() === name.toLowerCase()
  );
  if (isDuplicate) return;

  itemsCatalog[category].push(name);
  saveItemsCatalog();
  renderView('items');
}

function handleEditItem(category, index) {
  const oldName = itemsCatalog[category][index];
  if (oldName === undefined) return;

  pendingEdit = { category, index, oldName };
  editItemInput.value = oldName;
  hideEditItemError();
  editItemModal.hidden = false;
  editItemInput.focus();
  editItemInput.select();
}

function closeEditItemModal() {
  editItemModal.hidden = true;
  pendingEdit = null;
}

function showEditItemError(message) {
  editItemError.textContent = message;
  editItemError.hidden = false;
}

function hideEditItemError() {
  editItemError.hidden = true;
  editItemError.textContent = '';
}

function handleEditItemSave() {
  if (!pendingEdit) return;

  const { category, index, oldName } = pendingEdit;
  const newName = editItemInput.value.trim();

  hideEditItemError();

  if (!newName) {
    showEditItemError('Please enter an item name.');
    return;
  }

  if (newName === oldName) {
    closeEditItemModal();
    return;
  }

  const isDuplicate = itemsCatalog[category].some(
    (item, i) => i !== index && item.toLowerCase() === newName.toLowerCase()
  );
  if (isDuplicate) {
    showEditItemError('An item with that name already exists in this category.');
    return;
  }

  itemsCatalog[category][index] = newName;
  saveItemsCatalog();
  renameItemEverywhere(oldName, newName);
  closeEditItemModal();
  renderView('items');
}

// Item names are stored as plain strings throughout locationStocks, locationLogs,
// and both request queues — renaming a catalog entry must cascade everywhere so
// existing stock and history don't get silently orphaned under the old name.
function renameItemEverywhere(oldName, newName) {
  Object.values(locationStocks).forEach((stock) => {
    if (Object.prototype.hasOwnProperty.call(stock, oldName)) {
      stock[newName] = (stock[newName] || 0) + stock[oldName];
      delete stock[oldName];
    }
  });
  saveLocationStocks();

  Object.values(locationLogs).forEach((logs) => {
    logs.forEach((log) => {
      if (log.item === oldName) log.item = newName;
    });
  });
  saveLocationLogs();

  warehouseRequests.forEach((request) => {
    if (request.item === oldName) request.item = newName;
  });
  saveWarehouseRequests();

  kitchenRequests.forEach((request) => {
    if (request.item === oldName) request.item = newName;
  });
  saveKitchenRequests();
}

function handleRemoveItem(category, index) {
  const itemName = itemsCatalog[category][index];
  if (itemName === undefined) return;

  pendingRemoval = { category, index };
  confirmMessage.innerHTML = `Remove <strong>${escapeHtml(itemName)}</strong> from the catalog?`;
  confirmOverlay.hidden = false;
}

function closeConfirmDialog() {
  confirmOverlay.hidden = true;
  pendingRemoval = null;
}

function confirmRemoval() {
  if (!pendingRemoval) return;

  const { category, index } = pendingRemoval;
  itemsCatalog[category].splice(index, 1);
  saveItemsCatalog();
  closeConfirmDialog();
  renderView('items');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// ===================== Warehouse View =====================

function renderWarehouseView() {
  warehouseSubtabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.subtab === activeWarehouseSubtab);
  });

  if (activeWarehouseSubtab === 'general') {
    renderGeneralInventorySubtab();
  } else if (activeWarehouseSubtab === 'kitchen') {
    // Kitchen subtab additionally lets the Warehouse ask Kitchen for processed items.
    renderKitchenSubtabContent();
  } else {
    // Shop 1-3 subtabs: review and action requests sent by that location.
    renderIncomingRequestsPanel(activeWarehouseSubtab);
  }
}

function renderGeneralInventorySubtab() {
  renderInventoryDashboard(warehouseSubtabContent, getActiveLocationKey());
}

const REQUEST_STATUS_BADGE_CLASSES = {
  Pending: 'status-badge status-pending',
  Dispatched: 'status-badge status-dispatched',
  Received: 'status-badge status-received',
  Rejected: 'status-badge status-rejected',
};

// Decides which action button(s) a Pending request from a Shop/Kitchen gets,
// based on whether the Warehouse currently holds enough stock to fulfil it:
//   - enough stock      -> Dispatch (sends the full requested quantity)
//   - some stock, not enough -> Send Partial (lets staff send what's available)
//   - no stock at all   -> neither — Reject is the only option
// This stops a Dispatch from ever pushing locationStocks.warehouse negative.
function buildWarehouseRequestActionButtonsHtml(request) {
  if (request.status !== 'Pending') return '';

  const availableQty = locationStocks.warehouse[request.item] || 0;
  let primaryBtn = '';

  if (availableQty >= request.qty) {
    primaryBtn = `<button type="button" class="dispatch-request-btn" data-request-id="${request.id}">Dispatch</button>`;
  } else if (availableQty > 0) {
    primaryBtn = `<button type="button" class="partial-dispatch-btn" data-request-id="${request.id}">Send Partial</button>`;
  }

  return `<div class="request-action-group">
            ${primaryBtn}
            <button type="button" class="reject-request-btn" data-request-id="${request.id}">Reject</button>
          </div>`;
}

// Builds the "Requests from <Location>" section markup — shared by the plain
// incoming-requests panel (Shop 1-3) and the Kitchen subtab, which additionally
// shows the warehouse's own outgoing "Ask Kitchen" requests below it.
function buildIncomingRequestsSectionHtml(locationKey) {
  const locationLabel = WAREHOUSE_SUBTAB_LABELS[locationKey] || locationKey;

  const requests = warehouseRequests
    .filter((request) => request.fromLocation === locationKey)
    .sort((a, b) => b.timestamp - a.timestamp);

  return `
    <section class="requests-history">
      <h3 class="requests-history-title">Requests from ${escapeHtml(locationLabel)}</h3>
      ${requests.length
        ? `<div class="requests-table-wrap">
            <table class="requests-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th></th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${requests.map((request) => `
                  <tr>
                    <td>${escapeHtml(request.item)}</td>
                    <td>${request.qty}</td>
                    <td><span class="${REQUEST_STATUS_BADGE_CLASSES[request.status] || 'status-badge'}">${escapeHtml(request.status)}</span></td>
                    <td>${buildWarehouseRequestActionButtonsHtml(request)}</td>
                    <td class="request-timestamp-cell">${formatLogTimestamp(request.timestamp)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`
        : `<p class="empty-list-msg">No requests from ${escapeHtml(locationLabel)} yet.</p>`}
    </section>
  `;
}

function wireIncomingRequestActionListeners(container) {
  container.querySelectorAll('.dispatch-request-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDispatchRequest(Number(btn.dataset.requestId)));
  });

  container.querySelectorAll('.partial-dispatch-btn').forEach((btn) => {
    btn.addEventListener('click', () => openPartialDispatchModal(Number(btn.dataset.requestId)));
  });

  container.querySelectorAll('.reject-request-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleRejectRequest(Number(btn.dataset.requestId)));
  });
}

// Warehouse-side view of a single location's requests — lets Warehouse staff
// (and Manager, who shares this same render path) Dispatch or Reject Pending
// requests. Dispatching also subtracts stock straight from the warehouse's
// own General Inventory and logs the transaction.
function renderIncomingRequestsPanel(locationKey) {
  warehouseSubtabContent.innerHTML = buildIncomingRequestsSectionHtml(locationKey);
  wireIncomingRequestActionListeners(warehouseSubtabContent);
}

// Kitchen subtab shows the usual "Requests from Kitchen" panel, plus a form
// letting Warehouse staff ask Kitchen to make processed items, plus a history
// of those outgoing requests.
function renderKitchenSubtabContent() {
  const outgoingRequests = [...kitchenRequests].sort((a, b) => b.timestamp - a.timestamp);

  warehouseSubtabContent.innerHTML = `
    <div class="warehouse-requests">
      ${buildIncomingRequestsSectionHtml('kitchen')}

      <section class="request-form-card">
        <h3 class="request-form-title">Ask Kitchen for Processed Items</h3>
        <form id="ask-kitchen-form" class="request-form">
          <div class="stock-field">
            <label for="kitchen-request-item-search" class="stock-field-label">Item</label>
            <input type="text" id="kitchen-request-item-search" class="stock-item-search" placeholder="Search for a processed item..." autocomplete="off" />
            <ul id="kitchen-request-item-suggestions" class="stock-item-suggestions" hidden></ul>
          </div>
          <div class="stock-field">
            <label for="kitchen-request-qty-input" class="stock-field-label">Quantity</label>
            <input type="number" id="kitchen-request-qty-input" class="request-qty-input" min="1" step="1" placeholder="0" />
          </div>
          <p id="ask-kitchen-form-error" class="stock-modal-error" hidden></p>
          <button type="submit" class="request-send-btn">Ask Kitchen</button>
        </form>
      </section>

      <section class="requests-history">
        <h3 class="requests-history-title">Requests to Kitchen</h3>
        ${outgoingRequests.length
          ? `<div class="requests-table-wrap">
              <table class="requests-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Status</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  ${outgoingRequests.map((request) => `
                    <tr>
                      <td>${escapeHtml(request.item)}</td>
                      <td>${request.qty}</td>
                      <td><span class="${REQUEST_STATUS_BADGE_CLASSES[request.status] || 'status-badge'}">${escapeHtml(request.status)}</span></td>
                      <td class="request-timestamp-cell">${formatLogTimestamp(request.timestamp)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
          : `<p class="empty-list-msg">No requests sent to Kitchen yet.</p>`}
      </section>
    </div>
  `;

  wireIncomingRequestActionListeners(warehouseSubtabContent);

  const askKitchenForm = warehouseSubtabContent.querySelector('#ask-kitchen-form');
  askKitchenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    handleSendKitchenRequest(askKitchenForm);
  });

  setupItemSearchAutocomplete(
    askKitchenForm.querySelector('#kitchen-request-item-search'),
    askKitchenForm.querySelector('#kitchen-request-item-suggestions'),
    () => itemsCatalog.processed,
    () => hideRequestFormError(askKitchenForm)
  );
}

// Re-renders the current view without losing the user's place in a long
// request list. A plain renderView() rebuilds the table HTML from scratch, so
// every scrollable list (and the page itself) snaps back to scrollTop 0 — that
// makes working through requests further down a list painful, since each
// Dispatch/Reject/Mark as Received jumps you back to the very top.
function rerenderPreservingScroll() {
  const mainContent = document.querySelector('.main-content');
  const mainScrollTop = mainContent ? mainContent.scrollTop : 0;
  const wrapScrollTops = Array.from(document.querySelectorAll('.requests-table-wrap')).map((el) => el.scrollTop);

  renderView(currentViewKey);

  if (mainContent) mainContent.scrollTop = mainScrollTop;
  document.querySelectorAll('.requests-table-wrap').forEach((wrap, index) => {
    if (wrapScrollTops[index] !== undefined) wrap.scrollTop = wrapScrollTops[index];
  });
}

function handleDispatchRequest(requestId) {
  const request = warehouseRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  request.status = 'Dispatched';
  saveWarehouseRequests();

  const stock = locationStocks.warehouse;
  stock[request.item] = (stock[request.item] || 0) - request.qty;
  saveLocationStocks();

  locationLogs.warehouse.push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: `Request from ${WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation}`,
  });
  saveLocationLogs();

  rerenderPreservingScroll();
}

function handleRejectRequest(requestId) {
  const request = warehouseRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  request.status = 'Rejected';
  saveWarehouseRequests();

  rerenderPreservingScroll();
}

// Lets Warehouse staff fulfil a Pending request with whatever stock is on hand
// when there isn't enough to send the full requested quantity. Sending shrinks
// the request's own qty down to what was actually sent, so the rest of the
// flow (stock subtraction, logging, "Mark as Received") stays in sync with
// reality instead of ever letting locationStocks.warehouse go negative.
function openPartialDispatchModal(requestId) {
  const request = warehouseRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  const availableQty = locationStocks.warehouse[request.item] || 0;
  if (availableQty <= 0) return;

  pendingPartialDispatch = { source: 'warehouse', requestId };

  const fromLabel = WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation;
  openPartialDispatchModalWithInfo(
    `Warehouse only has <strong>${availableQty}</strong> ${escapeHtml(request.item)} in stock, but ${escapeHtml(fromLabel)} requested <strong>${request.qty}</strong>. You can send up to <strong>${availableQty}</strong> now — the rest of the request will be dropped.`,
    availableQty
  );
}

// Mirrors openPartialDispatchModal for the Kitchen side of the flow — Warehouse
// asked Kitchen for processed items, but Kitchen doesn't have enough on hand to
// fulfil the request in full.
function openPartialKitchenDispatchModal(requestId) {
  const request = kitchenRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  const availableQty = locationStocks.kitchen[request.item] || 0;
  if (availableQty <= 0) return;

  pendingPartialDispatch = { source: 'kitchen', requestId };

  openPartialDispatchModalWithInfo(
    `Kitchen only has <strong>${availableQty}</strong> ${escapeHtml(request.item)} in stock, but Warehouse requested <strong>${request.qty}</strong>. You can send up to <strong>${availableQty}</strong> now — the rest of the request will be dropped.`,
    availableQty
  );
}

function openPartialDispatchModalWithInfo(infoHtml, availableQty) {
  partialDispatchInfo.innerHTML = infoHtml;

  partialDispatchQtyInput.value = '';
  partialDispatchQtyInput.max = String(availableQty);
  hidePartialDispatchError();

  partialDispatchModal.hidden = false;
  partialDispatchQtyInput.focus();
}

function closePartialDispatchModal() {
  partialDispatchModal.hidden = true;
  pendingPartialDispatch = null;
}

function showPartialDispatchError(message) {
  partialDispatchError.textContent = message;
  partialDispatchError.hidden = false;
}

function hidePartialDispatchError() {
  partialDispatchError.hidden = true;
  partialDispatchError.textContent = '';
}

// Shared by both partial-dispatch flows so the rules — and their error copy —
// for "how much can actually be sent" stay identical no matter which side
// (Warehouse or Kitchen) is doing the sending.
function readPartialDispatchQuantity(availableQty, itemName) {
  const sendQty = Number(partialDispatchQtyInput.value);

  if (!Number.isFinite(sendQty) || sendQty <= 0) {
    return { error: 'Please enter a quantity greater than zero.' };
  }

  if (sendQty > availableQty) {
    return { error: `You can send at most ${availableQty} ${itemName}.` };
  }

  return { value: sendQty };
}

function handleConfirmPartialDispatch() {
  if (!pendingPartialDispatch) return;

  if (pendingPartialDispatch.source === 'kitchen') {
    confirmPartialKitchenDispatch();
  } else {
    confirmPartialWarehouseDispatch();
  }
}

function confirmPartialWarehouseDispatch() {
  const request = warehouseRequests.find((entry) => entry.id === pendingPartialDispatch.requestId);
  if (!request || request.status !== 'Pending') {
    closePartialDispatchModal();
    return;
  }

  const stock = locationStocks.warehouse;
  const availableQty = stock[request.item] || 0;

  hidePartialDispatchError();
  const result = readPartialDispatchQuantity(availableQty, request.item);
  if (result.error) {
    showPartialDispatchError(result.error);
    return;
  }
  const sendQty = result.value;

  request.qty = sendQty;
  request.status = 'Dispatched';
  saveWarehouseRequests();

  stock[request.item] = roundToTwoDecimals(availableQty - sendQty);
  saveLocationStocks();

  locationLogs.warehouse.push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: sendQty,
    category: getCurrentUserRole(),
    requestTag: `Partial dispatch to ${WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation}`,
  });
  saveLocationLogs();

  closePartialDispatchModal();
  rerenderPreservingScroll();
}

// Mirrors confirmPartialWarehouseDispatch for Kitchen fulfilling part of a
// "Ask Kitchen" request — also moves the sent quantity straight into
// locationStocks.warehouse and double-logs it, just like a full dispatch does.
function confirmPartialKitchenDispatch() {
  const request = kitchenRequests.find((entry) => entry.id === pendingPartialDispatch.requestId);
  if (!request || request.status !== 'Pending') {
    closePartialDispatchModal();
    return;
  }

  const stock = locationStocks.kitchen;
  const availableQty = stock[request.item] || 0;

  hidePartialDispatchError();
  const result = readPartialDispatchQuantity(availableQty, request.item);
  if (result.error) {
    showPartialDispatchError(result.error);
    return;
  }
  const sendQty = result.value;

  request.qty = sendQty;
  request.status = 'Dispatched';
  saveKitchenRequests();

  stock[request.item] = roundToTwoDecimals(availableQty - sendQty);
  locationStocks.warehouse[request.item] = roundToTwoDecimals((locationStocks.warehouse[request.item] || 0) + sendQty);
  saveLocationStocks();

  locationLogs.kitchen.push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: sendQty,
    category: getCurrentUserRole(),
    requestTag: 'Partial dispatch to Warehouse',
  });
  locationLogs.warehouse.push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'add',
    qty: sendQty,
    category: getCurrentUserRole(),
    requestTag: 'Partial receipt from Kitchen',
  });
  saveLocationLogs();

  closePartialDispatchModal();
  rerenderPreservingScroll();
}

// Shared by Warehouse > General Inventory and every location's (Kitchen,
// Shop 1-3) own General Inventory subtab — identical UI, but each instance
// reads/writes only its own locationKey's slice of locationStocks/locationLogs
// so stock numbers and history never mix between locations.
function renderInventoryDashboard(container, locationKey) {
  activeInventoryLocation = locationKey;
  const stock = locationStocks[locationKey];

  container.innerHTML = `
    <div class="general-inventory">
      <div class="warehouse-toolbar">
        <input type="text" class="warehouse-search-input" placeholder="Search items..." autocomplete="off" />
        <div class="warehouse-toolbar-actions">
          <button type="button" class="warehouse-toolbar-btn" data-inventory-action="update-stock">Update Stock</button>
          <button type="button" class="warehouse-toolbar-btn" data-inventory-action="export-csv">Export Excel (CSV)</button>
          <button type="button" class="warehouse-toolbar-btn" data-inventory-action="export-logs">Export Logs (TXT)</button>
        </div>
      </div>

      <div class="inventory-columns">
        ${ITEM_CATEGORIES.map((category) => `
          <section class="inventory-column">
            <h3 class="inventory-column-title">${category.label}</h3>
            ${itemsCatalog[category.key].length
              ? `<ul class="inventory-list">
                  ${itemsCatalog[category.key]
                    .map((item) => `
                      <li class="inventory-row">
                        <span class="inventory-item-name">${escapeHtml(item)}</span>
                        <span class="inventory-item-qty">${stock[item] || 0}</span>
                      </li>
                    `)
                    .join('')}
                </ul>`
              : `<p class="empty-list-msg">No items in this category yet.</p>`}
          </section>
        `).join('')}
      </div>

      <section class="inventory-log-feed">
        <h3 class="inventory-log-title">Log Update History</h3>
        ${renderLogFeedHtml()}
      </section>
    </div>
  `;

  const searchInput = container.querySelector('.warehouse-search-input');
  searchInput.addEventListener('input', () => {
    filterInventoryRows(container, searchInput);
  });

  container.querySelector('[data-inventory-action="update-stock"]').addEventListener('click', openStockModal);
  container.querySelector('[data-inventory-action="export-csv"]').addEventListener('click', handleExportCsv);
  container.querySelector('[data-inventory-action="export-logs"]').addEventListener('click', handleExportLogs);
}

function filterInventoryRows(container, searchInput) {
  const query = searchInput.value.trim().toLowerCase();

  container.querySelectorAll('.inventory-row').forEach((row) => {
    const name = row.querySelector('.inventory-item-name').textContent.toLowerCase();
    row.hidden = query.length > 0 && !name.includes(query);
  });
}

function renderLogFeedHtml() {
  const logs = locationLogs[activeInventoryLocation];

  if (!logs.length) {
    return `<p class="empty-list-msg">No stock updates logged yet.</p>`;
  }

  const sortedLogs = [...logs].sort((a, b) => b.timestamp - a.timestamp);

  return `
    <ul class="log-feed-list">
      ${sortedLogs.map((log) => `
        <li class="log-feed-row">
          <span class="log-feed-time">${formatLogTimestamp(log.timestamp)}</span>
          <span class="log-feed-detail">
            <strong>${escapeHtml(log.item)}</strong> ${log.actionType === 'add' ? 'added' : 'subtracted'} ${log.qty}
            <span class="log-feed-category">(${escapeHtml(ROLE_LABELS[log.category] || log.category)})</span>
            ${log.requestTag ? `<span class="log-feed-tag">(${escapeHtml(log.requestTag)})</span>` : ''}
          </span>
        </li>
      `).join('')}
    </ul>
  `;
}

function formatLogDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLogTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatLogTimestamp(timestamp) {
  const date = new Date(timestamp);
  return `${formatLogDate(date)} ${formatLogTime(date)}`;
}

// ===================== Location Views (Kitchen / Shop 1-3) =====================

function renderLocationView(viewKey) {
  viewContent.innerHTML = `
    <div class="location-view">
      <nav class="subtab-bar">
        <button class="warehouse-subtab-btn" data-subtab="general">General Inventory</button>
        <button class="warehouse-subtab-btn" data-subtab="warehouse">Warehouse</button>
      </nav>
      <div id="location-subtab-content" class="location-subtab-content"></div>
    </div>
  `;

  viewContent.querySelectorAll('.subtab-bar .warehouse-subtab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.subtab === activeLocationSubtab);
    btn.addEventListener('click', () => {
      if (btn.dataset.subtab === activeLocationSubtab) return;
      activeLocationSubtab = btn.dataset.subtab;
      renderView(viewKey);
    });
  });

  renderLocationSubtabContent(viewKey);
}

function renderLocationSubtabContent(viewKey) {
  const container = viewContent.querySelector('#location-subtab-content');

  if (activeLocationSubtab === 'warehouse') {
    renderWarehouseRequestsPanel(container, viewKey);
  } else {
    // 'general' — this location's own stock, e.g. Shop 1 sees locationStocks.shop1 / locationLogs.shop1.
    renderInventoryDashboard(container, viewKey);
  }
}

// ===================== Warehouse Requests (Shop / Kitchen side) =====================

function renderWarehouseRequestsPanel(container, locationKey) {
  const requests = warehouseRequests
    .filter((request) => request.fromLocation === locationKey)
    .sort((a, b) => b.timestamp - a.timestamp);

  container.innerHTML = `
    <div class="warehouse-requests">
      <section class="request-form-card">
        <h3 class="request-form-title">Submit Request to Warehouse</h3>
        <form id="warehouse-request-form" class="request-form">
          <div class="stock-field">
            <label for="request-item-search" class="stock-field-label">Item</label>
            <input type="text" id="request-item-search" class="stock-item-search" placeholder="Search for an item..." autocomplete="off" />
            <ul id="request-item-suggestions" class="stock-item-suggestions" hidden></ul>
          </div>
          <div class="stock-field">
            <label for="request-qty-input" class="stock-field-label">Quantity</label>
            <input type="number" id="request-qty-input" class="request-qty-input" min="1" step="1" placeholder="0" />
          </div>
          <p id="request-form-error" class="stock-modal-error" hidden></p>
          <button type="submit" class="request-send-btn">Send Request</button>
        </form>
      </section>

      <section class="requests-history">
        <h3 class="requests-history-title">Requests to Warehouse</h3>
        ${requests.length
          ? `<div class="requests-table-wrap">
              <table class="requests-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Status</th>
                    <th></th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  ${requests.map((request) => `
                    <tr>
                      <td>${escapeHtml(request.item)}</td>
                      <td>${request.qty}</td>
                      <td><span class="${REQUEST_STATUS_BADGE_CLASSES[request.status] || 'status-badge'}">${escapeHtml(request.status)}</span></td>
                      <td>${request.status === 'Dispatched'
                        ? `<button type="button" class="mark-received-btn" data-request-id="${request.id}">Mark as Received</button>`
                        : ''}</td>
                      <td class="request-timestamp-cell">${formatLogTimestamp(request.timestamp)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
          : `<p class="empty-list-msg">No requests sent yet.</p>`}
      </section>

      ${locationKey === 'kitchen' ? buildIncomingWarehouseRequestsSectionHtml() : ''}
    </div>
  `;

  const form = container.querySelector('#warehouse-request-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handleSendWarehouseRequest(form, locationKey);
  });

  setupItemSearchAutocomplete(
    form.querySelector('#request-item-search'),
    form.querySelector('#request-item-suggestions'),
    getCatalogItemNames,
    () => hideRequestFormError(form)
  );

  container.querySelectorAll('.mark-received-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleMarkRequestReceived(Number(btn.dataset.requestId));
    });
  });

  if (locationKey === 'kitchen') {
    container.querySelectorAll('.dispatch-kitchen-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleDispatchKitchenRequest(Number(btn.dataset.requestId)));
    });

    container.querySelectorAll('.partial-dispatch-kitchen-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPartialKitchenDispatchModal(Number(btn.dataset.requestId)));
    });

    container.querySelectorAll('.reject-kitchen-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleRejectKitchenRequest(Number(btn.dataset.requestId)));
    });
  }
}

// Kitchen's view of the requests Warehouse has sent it — lets Kitchen staff
// (and Manager) Dispatch or Reject Pending requests for processed items.
// Mirrors buildWarehouseRequestActionButtonsHtml for the Kitchen side: a
// Pending "Ask Kitchen" request only gets a full Dispatch button when Kitchen
// actually holds enough stock to fulfil it, a "Send Partial" button when it
// holds some (but not enough), and just Reject when it holds none — so
// dispatching can never push locationStocks.kitchen negative either.
function buildIncomingKitchenRequestActionButtonsHtml(request) {
  if (request.status !== 'Pending') return '';

  const availableQty = locationStocks.kitchen[request.item] || 0;
  let primaryBtn = '';

  if (availableQty >= request.qty) {
    primaryBtn = `<button type="button" class="dispatch-request-btn dispatch-kitchen-action-btn" data-request-id="${request.id}">Dispatch</button>`;
  } else if (availableQty > 0) {
    primaryBtn = `<button type="button" class="partial-dispatch-btn partial-dispatch-kitchen-action-btn" data-request-id="${request.id}">Send Partial</button>`;
  }

  return `<div class="request-action-group">
            ${primaryBtn}
            <button type="button" class="reject-request-btn reject-kitchen-action-btn" data-request-id="${request.id}">Reject</button>
          </div>`;
}

function buildIncomingWarehouseRequestsSectionHtml() {
  const requests = [...kitchenRequests].sort((a, b) => b.timestamp - a.timestamp);

  return `
    <section class="requests-history">
      <h3 class="requests-history-title">Incoming Warehouse Requests</h3>
      ${requests.length
        ? `<div class="requests-table-wrap">
            <table class="requests-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th></th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${requests.map((request) => `
                  <tr>
                    <td>${escapeHtml(request.item)}</td>
                    <td>${request.qty}</td>
                    <td><span class="${REQUEST_STATUS_BADGE_CLASSES[request.status] || 'status-badge'}">${escapeHtml(request.status)}</span></td>
                    <td>${buildIncomingKitchenRequestActionButtonsHtml(request)}</td>
                    <td class="request-timestamp-cell">${formatLogTimestamp(request.timestamp)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`
        : `<p class="empty-list-msg">No requests from Warehouse yet.</p>`}
    </section>
  `;
}

function showRequestFormError(form, message) {
  const errorEl = form.querySelector('.stock-modal-error');
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function hideRequestFormError(form) {
  const errorEl = form.querySelector('.stock-modal-error');
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function handleSendWarehouseRequest(form, locationKey) {
  const itemSearchInput = form.querySelector('#request-item-search');
  const qtyInput = form.querySelector('#request-qty-input');

  const itemName = findCatalogItemByName(itemSearchInput.value);
  const quantity = Number(qtyInput.value);

  hideRequestFormError(form);

  if (!itemName) {
    showRequestFormError(form, 'Please select a valid item from the catalog.');
    return;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showRequestFormError(form, 'Please enter a quantity greater than zero.');
    return;
  }

  warehouseRequests.push({
    id: Date.now(),
    timestamp: Date.now(),
    fromLocation: locationKey,
    item: itemName,
    qty: quantity,
    status: 'Pending',
  });
  saveWarehouseRequests();

  renderView(currentViewKey);
}

function handleMarkRequestReceived(requestId) {
  const request = warehouseRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Dispatched') return;

  request.status = 'Received';
  saveWarehouseRequests();

  const stock = locationStocks[request.fromLocation];
  stock[request.item] = (stock[request.item] || 0) + request.qty;
  saveLocationStocks();

  locationLogs[request.fromLocation].push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'add',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: 'Warehouse Request',
  });
  saveLocationLogs();

  rerenderPreservingScroll();
}

function handleSendKitchenRequest(form) {
  const itemSearchInput = form.querySelector('#kitchen-request-item-search');
  const qtyInput = form.querySelector('#kitchen-request-qty-input');

  const itemName = findItemInList(itemSearchInput.value, itemsCatalog.processed);
  const quantity = Number(qtyInput.value);

  hideRequestFormError(form);

  if (!itemName) {
    showRequestFormError(form, 'Please select a valid processed item.');
    return;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showRequestFormError(form, 'Please enter a quantity greater than zero.');
    return;
  }

  kitchenRequests.push({
    id: Date.now(),
    timestamp: Date.now(),
    item: itemName,
    qty: quantity,
    status: 'Pending',
  });
  saveKitchenRequests();

  renderView(currentViewKey);
}

function handleDispatchKitchenRequest(requestId) {
  const request = kitchenRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  const kitchenStock = locationStocks.kitchen;
  const availableQty = kitchenStock[request.item] || 0;

  request.status = 'Dispatched';
  saveKitchenRequests();

  kitchenStock[request.item] = availableQty - request.qty;
  locationStocks.warehouse[request.item] = (locationStocks.warehouse[request.item] || 0) + request.qty;
  saveLocationStocks();

  locationLogs.kitchen.push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: 'Dispatched to Warehouse',
  });

  locationLogs.warehouse.push({
    timestamp: Date.now(),
    item: request.item,
    actionType: 'add',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: 'Received from Kitchen',
  });
  saveLocationLogs();

  rerenderPreservingScroll();
}

function handleRejectKitchenRequest(requestId) {
  const request = kitchenRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  request.status = 'Rejected';
  saveKitchenRequests();

  rerenderPreservingScroll();
}

// ===================== Stock Update Modal =====================

function getCatalogItemNames() {
  return [...itemsCatalog.raw, ...itemsCatalog.processed];
}

function findCatalogItemByName(name) {
  return findItemInList(name, getCatalogItemNames());
}

function findItemInList(name, list) {
  const normalized = name.trim().toLowerCase();
  return list.find((item) => item.toLowerCase() === normalized) || null;
}

// Keeps fractional stock subtraction (e.g. 2.3 - 1.1) from drifting into
// floating-point noise like 1.1999999999999997.
function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

// Wires a text input + suggestions <ul> into a "type to filter" autocomplete:
// matches are items whose name starts with the typed text, refreshed on every
// keystroke/focus and clickable to fill the input. `getItems` is a function so
// the list can stay live (e.g. itemsCatalog.processed can grow between renders).
function setupItemSearchAutocomplete(input, suggestionsList, getItems, onChange) {
  function hideSuggestions() {
    suggestionsList.innerHTML = '';
    suggestionsList.hidden = true;
  }

  function renderSuggestions(query) {
    const normalized = query.trim().toLowerCase();
    const items = getItems();
    const matches = normalized
      ? items.filter((item) => item.toLowerCase().startsWith(normalized))
      : items;

    if (!matches.length) {
      hideSuggestions();
      return;
    }

    suggestionsList.innerHTML = matches
      .map((item) => `<li class="stock-suggestion-item" data-item="${escapeHtml(item)}">${escapeHtml(item)}</li>`)
      .join('');
    suggestionsList.hidden = false;
  }

  input.addEventListener('input', () => {
    if (onChange) onChange();
    renderSuggestions(input.value);
  });

  input.addEventListener('focus', () => {
    renderSuggestions(input.value);
  });

  input.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 120);
  });

  suggestionsList.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  suggestionsList.addEventListener('click', (event) => {
    const suggestion = event.target.closest('.stock-suggestion-item');
    if (!suggestion) return;

    input.value = suggestion.dataset.item;
    hideSuggestions();
    if (onChange) onChange();
  });
}

function getCurrentUserRole() {
  const session = loadSession();
  return session ? session.role : null;
}

function openStockModal() {
  stockItemSearch.value = '';
  stockActionSelect.value = 'add';
  stockQuantityInput.value = '';
  hideStockModalError();
  hideStockSuggestions();

  stockModal.hidden = false;
  stockItemSearch.focus();
}

function closeStockModal() {
  stockModal.hidden = true;
  hideStockSuggestions();
}

function hideStockSuggestions() {
  stockItemSuggestions.innerHTML = '';
  stockItemSuggestions.hidden = true;
}

function renderStockItemSuggestions(query) {
  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? getCatalogItemNames().filter((item) => item.toLowerCase().includes(normalized))
    : getCatalogItemNames();

  if (!matches.length) {
    hideStockSuggestions();
    return;
  }

  stockItemSuggestions.innerHTML = matches
    .map((item) => `<li class="stock-suggestion-item" data-item="${escapeHtml(item)}">${escapeHtml(item)}</li>`)
    .join('');
  stockItemSuggestions.hidden = false;
}

function showStockModalError(message) {
  stockModalError.textContent = message;
  stockModalError.hidden = false;
}

function hideStockModalError() {
  stockModalError.hidden = true;
  stockModalError.textContent = '';
}

function handleStockSave() {
  const itemName = findCatalogItemByName(stockItemSearch.value);
  const quantity = Number(stockQuantityInput.value);
  const actionType = stockActionSelect.value;

  if (!itemName) {
    showStockModalError('Please select a valid item from the catalog.');
    return;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showStockModalError('Please enter a quantity greater than zero.');
    return;
  }

  const locationKey = activeInventoryLocation;
  const stock = locationStocks[locationKey];

  const currentQty = stock[itemName] || 0;
  stock[itemName] = actionType === 'add'
    ? currentQty + quantity
    : currentQty - quantity;
  saveLocationStocks();

  locationLogs[locationKey].push({
    timestamp: Date.now(),
    item: itemName,
    actionType,
    qty: quantity,
    category: getCurrentUserRole(),
  });
  saveLocationLogs();

  closeStockModal();
  renderView(currentViewKey);
}

// ===================== Exports =====================

function csvEscape(value) {
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function getItemCategoryLabel(itemName) {
  if (itemsCatalog.raw.includes(itemName)) return 'Raw Items';
  if (itemsCatalog.processed.includes(itemName)) return 'Processed Items';
  return 'Uncategorized';
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getOrdinalSuffix(day) {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';

  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function formatOrdinalDateHeader(date) {
  const day = date.getDate();
  return `${day}${getOrdinalSuffix(day)} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function buildMonthlyInventoryCsv() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const sortedLogs = [...locationLogs[activeInventoryLocation]].sort((a, b) => a.timestamp - b.timestamp);
  const allItems = [...getCatalogItemNames()].sort((a, b) => a.localeCompare(b));

  // Walk the month day-by-day (1st through today), carrying running totals
  // forward across days so every date gets a snapshot — even quiet ones.
  const runningTotals = {};
  let logIndex = 0;
  const dailyActivities = [];
  const dailySnapshots = [];

  for (let day = 1; day <= now.getDate(); day += 1) {
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999).getTime();
    const activity = new Map();

    while (logIndex < sortedLogs.length && sortedLogs[logIndex].timestamp <= endOfDay) {
      const log = sortedLogs[logIndex];
      const currentTotal = runningTotals[log.item] || 0;
      runningTotals[log.item] = log.actionType === 'add' ? currentTotal + log.qty : currentTotal - log.qty;

      if (!activity.has(log.item)) activity.set(log.item, { added: 0, subtracted: 0 });
      const entry = activity.get(log.item);
      if (log.actionType === 'add') entry.added += log.qty;
      else entry.subtracted += log.qty;

      logIndex += 1;
    }

    dailyActivities.push(activity);
    dailySnapshots.push({ ...runningTotals });
  }

  const itemColumns = ['Item Category', 'Item Name'];
  const dataColumns = ['Total Added (Bought)', 'Total Subtracted (Sold/Used)', 'End of Day Total'];
  const dayCount = now.getDate();

  // Item columns are written once on the left; each date then contributes
  // just its data columns, repeated side by side — so the item list isn't
  // duplicated for every day in the month.
  const dateHeaderRow = [...itemColumns.map(() => '')];
  const columnHeaderRow = [...itemColumns];

  for (let day = 1; day <= dayCount; day += 1) {
    dateHeaderRow.push(formatOrdinalDateHeader(new Date(year, month, day)), ...Array(dataColumns.length - 1).fill(''));
    columnHeaderRow.push(...dataColumns);
  }

  const lines = [];
  lines.push(dateHeaderRow.map(csvEscape).join(','));
  lines.push(columnHeaderRow.map(csvEscape).join(','));

  allItems.forEach((item) => {
    const row = [getItemCategoryLabel(item), item];

    for (let day = 1; day <= dayCount; day += 1) {
      const index = day - 1;
      const itemActivity = dailyActivities[index].get(item) || { added: 0, subtracted: 0 };
      const snapshot = dailySnapshots[index];
      const endOfDayTotal = snapshot[item] !== undefined ? snapshot[item] : 0;

      row.push(String(itemActivity.added), String(itemActivity.subtracted), String(endOfDayTotal));
    }

    lines.push(row.map(csvEscape).join(','));
  });

  return lines.join('\r\n');
}

function buildInventoryLogText() {
  const sortedLogs = [...locationLogs[activeInventoryLocation]].sort((a, b) => a.timestamp - b.timestamp);

  return sortedLogs
    .map((log) => {
      const roleLabel = (ROLE_LABELS[log.category] || log.category || '').toUpperCase();
      const action = log.actionType === 'add' ? 'Added' : 'Subtracted';
      return `[${formatLogTimestamp(log.timestamp)}] ${roleLabel}: ${action} ${log.qty} ${log.item}`;
    })
    .join('\r\n');
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function handleExportCsv() {
  const now = new Date();
  const filename = `puchkas-inventory-${activeInventoryLocation}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.csv`;

  downloadTextFile(filename, buildMonthlyInventoryCsv(), 'text/csv;charset=utf-8;');
}

function handleExportLogs() {
  const filename = `puchkas-inventory-logs-${activeInventoryLocation}-${formatLogDate(new Date())}.txt`;

  downloadTextFile(filename, buildInventoryLogText(), 'text/plain;charset=utf-8;');
}

function logout() {
  clearSession();
  selectedRole = null;
  enteredPin = [];

  appShell.style.display = 'none';
  appShell.classList.remove('sidebar-open');
  loginScreen.style.display = 'flex';
}

// ===================== Mobile Sidebar Drawer =====================

function toggleSidebarDrawer() {
  appShell.classList.toggle('sidebar-open');
}

function closeSidebarDrawer() {
  appShell.classList.remove('sidebar-open');
}

// ===================== Event Listeners =====================

roleCards.forEach((card) => {
  card.addEventListener('click', () => {
    openPinPad(card.dataset.role);
  });
});

keypadButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    handleKeyPress(btn.dataset.key);
  });
});

pinCancelBtn.addEventListener('click', closePinPad);

confirmRemoveBtn.addEventListener('click', confirmRemoval);
confirmCancelBtn.addEventListener('click', closeConfirmDialog);

stockSaveBtn.addEventListener('click', handleStockSave);
stockCancelBtn.addEventListener('click', closeStockModal);

editItemSaveBtn.addEventListener('click', handleEditItemSave);
editItemCancelBtn.addEventListener('click', closeEditItemModal);

editItemInput.addEventListener('input', hideEditItemError);

editItemInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleEditItemSave();
  }
});

partialDispatchSendBtn.addEventListener('click', handleConfirmPartialDispatch);
partialDispatchCancelBtn.addEventListener('click', closePartialDispatchModal);

partialDispatchQtyInput.addEventListener('input', hidePartialDispatchError);

partialDispatchQtyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleConfirmPartialDispatch();
  }
});

stockItemSearch.addEventListener('input', () => {
  hideStockModalError();
  renderStockItemSuggestions(stockItemSearch.value);
});

stockItemSearch.addEventListener('focus', () => {
  renderStockItemSuggestions(stockItemSearch.value);
});

stockItemSearch.addEventListener('blur', () => {
  setTimeout(hideStockSuggestions, 120);
});

stockItemSuggestions.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

stockItemSuggestions.addEventListener('click', (event) => {
  const suggestion = event.target.closest('.stock-suggestion-item');
  if (!suggestion) return;

  stockItemSearch.value = suggestion.dataset.item;
  hideStockSuggestions();
  hideStockModalError();
});

logoutBtn.addEventListener('click', logout);

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    renderView(btn.dataset.view);
  });
});

warehouseSubtabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    activeWarehouseSubtab = btn.dataset.subtab;
    renderWarehouseView();
  });
});

hamburgerBtn.addEventListener('click', toggleSidebarDrawer);
sidebarBackdrop.addEventListener('click', closeSidebarDrawer);

// ===================== Init =====================

(function init() {
  const session = loadSession();

  if (session && session.role && PINS[session.role]) {
    enterApp(session.role);
  }
})();
