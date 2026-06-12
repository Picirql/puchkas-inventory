// ===================== Config =====================

// Fill these in with your Supabase project's URL and anon/public key
// (Project Settings -> API in the Supabase dashboard).
const SUPABASE_URL = 'https://ilukgcqcvysduxczhrfi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsdWtnY3FjdnlzZHV4Y3pocmZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzgwMTEsImV4cCI6MjA5NjY1NDAxMX0.2H9mO-qpQKJLNffqLB3Ekmu5QUWadRwkF5DhzC3k8SE';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PINS = {
  manager: '1234',
  warehouse: '2222',
  shop1: '1111',
  shop2: '3333',
  shop3: '4444',
  shop4: '6666',
  kitchen: '5555',
};

const ROLE_LABELS = {
  manager: 'Manager',
  warehouse: 'Warehouse',
  shop1: 'Shop 1',
  shop2: 'Shop 2',
  shop3: 'Shop 3',
  shop4: 'Shop 4',
  kitchen: 'Kitchen',
};

const ALL_VIEWS = ['items', 'warehouse', 'shop1', 'shop2', 'shop3', 'shop4', 'kitchen'];
const LOCATION_VIEWS = ['kitchen', 'shop1', 'shop2', 'shop3', 'shop4'];

const ROLE_ACCESS = {
  manager: ALL_VIEWS,
  warehouse: ['warehouse'],
  shop1: ['shop1'],
  shop2: ['shop2'],
  shop3: ['shop3'],
  shop4: ['shop4'],
  kitchen: ['kitchen'],
};

const SESSION_KEY = 'puchkasInventorySession';

// ===================== State =====================

let selectedRole = null;
let enteredPin = [];
let pendingRemoval = null;
let pendingEdit = null;
let pendingPartialDispatch = null;
let currentViewKey = null;
let pendingBatchUpdate = null; // { locationKey, changes: [{ item, actionType, qty }] }
let pendingLoginRole = null; // role to retry entering after a failed initial Supabase load

// All five of these are populated from Supabase by loadAllDataFromSupabase()
// once the user logs in — see "Supabase Sync" below. They start out empty so
// the app has a valid shape to render before that fetch resolves.
let itemsCatalog = { raw: [], processed: [] };

let activeWarehouseSubtab = 'general';
let activeLocationSubtab = 'general';

// Tracks which location's stock/logs the currently-rendered inventory
// dashboard (Warehouse > General Inventory, or a location's own General
// Inventory) is showing — every search/update/export operates on this.
let activeInventoryLocation = 'warehouse';

// Stocks and logs are partitioned per location so that updates made for one
// location (e.g. Kitchen) never bleed into another's (e.g. Shop 1) numbers.
let locationStocks = buildDefaultLocationStocks();
let locationLogs = buildDefaultLocationLogs();

// Elements: { id, timestamp, fromLocation, item, qty, status: 'Pending' | 'Dispatched' | 'Received' }
let warehouseRequests = [];

// Requests made by the Warehouse to the Kitchen (the reverse direction of warehouseRequests).
// Elements: { id, timestamp, item, qty, status: 'Pending' | 'Dispatched' | 'Rejected' }
let kitchenRequests = [];

// Per-location list of past days' archived logs: { id, archive_date }.
// Populated from the log_archives table — a daily job clears out `logs` and
// the request tables (see Supabase SQL setup) and stores that day's log
// history here as downloadable text. Content is fetched on demand when the
// user clicks Download, not held in memory for every archive.
let logArchives = buildDefaultLocationLogs();

// Per-location list of finished monthly inventory CSV sheets: { id, sheetMonth }.
// Populated from the inventory_sheets table — generated client-side once a
// month is complete (see ensurePreviousMonthSheets) from daily_item_activity /
// daily_stock_snapshots, and kept for 3 months. Content is fetched on demand
// when the user clicks Download.
let inventorySheets = buildDefaultLocationLogs();

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
const refreshDataBtn = document.getElementById('refresh-data-btn');
const navButtons = document.querySelectorAll('.nav-btn');
const viewContent = document.getElementById('view-content');

const dataLoadingOverlay = document.getElementById('data-loading-overlay');
const dataLoadingStatus = document.getElementById('data-loading-status');
const dataLoadingError = document.getElementById('data-loading-error');
const dataLoadingRetryBtn = document.getElementById('data-loading-retry-btn');

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
const stockSourceField = document.getElementById('stock-source-field');
const stockSourceSelect = document.getElementById('stock-source-select');
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

const batchSourceModal = document.getElementById('batch-source-modal');
const batchSourceSelect = document.getElementById('batch-source-select');
const batchSourceError = document.getElementById('batch-source-error');
const batchSourceConfirmBtn = document.getElementById('batch-source-confirm-btn');
const batchSourceCancelBtn = document.getElementById('batch-source-cancel-btn');

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

function buildDefaultLocationStocks() {
  return {
    warehouse: {},
    kitchen: {},
    shop1: {},
    shop2: {},
    shop3: {},
    shop4: {},
  };
}

function buildDefaultLocationLogs() {
  return {
    warehouse: [],
    kitchen: [],
    shop1: [],
    shop2: [],
    shop3: [],
    shop4: [],
  };
}

// ===================== Supabase Sync =====================

// Shows a small dismissible toast (top-right) when a background save to
// Supabase fails — the in-memory state and UI have already moved on
// optimistically, so this is the user's only signal that a write didn't
// reach the server and may need retrying.
function showSyncError(message) {
  const toast = document.createElement('div');
  toast.className = 'sync-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// Fetches the full current state from Supabase and replaces the in-memory
// itemsCatalog / locationStocks / locationLogs / warehouseRequests /
// kitchenRequests with it. Called once on login (and from the manual
// Refresh button) — every render function reads from these same variables,
// so nothing else needs to change.
async function loadAllDataFromSupabase() {
  const [itemsRes, stocksRes, logsRes, warehouseReqRes, kitchenReqRes, archivesRes, sheetsRes] = await Promise.all([
    supabaseClient.from('items').select('category, name'),
    supabaseClient.from('stocks').select('location, item_name, qty'),
    supabaseClient.from('logs').select('*'),
    supabaseClient.from('warehouse_requests').select('*'),
    supabaseClient.from('kitchen_requests').select('*'),
    supabaseClient.from('log_archives').select('id, location, archive_date').order('archive_date', { ascending: false }),
    supabaseClient.from('inventory_sheets').select('id, location, sheet_month').order('sheet_month', { ascending: false }),
  ]);

  const error = itemsRes.error || stocksRes.error || logsRes.error || warehouseReqRes.error || kitchenReqRes.error || archivesRes.error || sheetsRes.error;
  if (error) throw error;

  const catalog = { raw: [], processed: [] };
  itemsRes.data.forEach((row) => {
    if (catalog[row.category]) catalog[row.category].push(row.name);
  });
  itemsCatalog = catalog;

  const stocks = buildDefaultLocationStocks();
  stocksRes.data.forEach((row) => {
    if (!stocks[row.location]) stocks[row.location] = {};
    stocks[row.location][row.item_name] = Number(row.qty);
  });
  locationStocks = stocks;

  const logs = buildDefaultLocationLogs();
  logsRes.data.forEach((row) => {
    if (!logs[row.location]) logs[row.location] = [];
    const entry = {
      timestamp: Number(row.ts),
      item: row.item_name,
      actionType: row.action_type,
      qty: Number(row.qty),
      category: row.category,
    };
    if (row.source) entry.source = row.source;
    if (row.request_tag) entry.requestTag = row.request_tag;
    logs[row.location].push(entry);
  });
  locationLogs = logs;

  warehouseRequests = warehouseReqRes.data.map((row) => ({
    id: row.id,
    timestamp: Number(row.ts),
    fromLocation: row.from_location,
    item: row.item_name,
    qty: Number(row.qty),
    status: row.status,
  }));

  kitchenRequests = kitchenReqRes.data.map((row) => ({
    id: row.id,
    timestamp: Number(row.ts),
    item: row.item_name,
    qty: Number(row.qty),
    status: row.status,
  }));

  const archives = buildDefaultLocationLogs();
  archivesRes.data.forEach((row) => {
    if (!archives[row.location]) archives[row.location] = [];
    archives[row.location].push({ id: row.id, archiveDate: row.archive_date });
  });
  logArchives = archives;

  const sheets = buildDefaultLocationLogs();
  sheetsRes.data.forEach((row) => {
    if (!sheets[row.location]) sheets[row.location] = [];
    sheets[row.location].push({ id: row.id, sheetMonth: row.sheet_month });
  });
  inventorySheets = sheets;

  ensurePreviousMonthSheets().then((changed) => {
    if (changed) rerenderPreservingScroll();
  });
}

// Fetches one archived day's log text on demand (the listing in
// loadAllDataFromSupabase only carries the date, not the full content) and
// triggers a download in the same .txt format as "Export Logs".
async function downloadLogArchive(id, location, archiveDate) {
  const { data, error } = await supabaseClient.from('log_archives').select('content').eq('id', id).single();
  if (error || !data) {
    showSyncError('Could not download archive — check your connection.');
    return;
  }
  downloadTextFile(`puchkas-inventory-logs-${location}-${archiveDate}.txt`, data.content, 'text/plain;charset=utf-8;');
}

// Each of these mirrors a single mutation already applied to the in-memory
// state (optimistic UI) by writing just the changed row(s) to Supabase.
// They're intentionally not awaited at most call sites — failures surface
// via showSyncError without blocking the UI.

async function upsertStocks(location, items) {
  if (!items.length) return;
  const rows = items.map(({ item, qty }) => ({ location, item_name: item, qty }));
  const { error } = await supabaseClient.from('stocks').upsert(rows, { onConflict: 'location,item_name' });
  if (error) showSyncError('Could not save stock change — check your connection.');
}

async function insertLogs(location, entries) {
  if (!entries.length) return;
  const rows = entries.map((entry) => ({
    location,
    ts: entry.timestamp,
    item_name: entry.item,
    action_type: entry.actionType,
    qty: entry.qty,
    category: entry.category || null,
    source: entry.source || null,
    request_tag: entry.requestTag || null,
  }));
  const { error } = await supabaseClient.from('logs').insert(rows);
  if (error) showSyncError('Could not save activity log — check your connection.');
}

async function insertWarehouseRequests(requests) {
  if (!requests.length) return;
  const rows = requests.map((r) => ({
    id: r.id, ts: r.timestamp, from_location: r.fromLocation, item_name: r.item, qty: r.qty, status: r.status,
  }));
  const { error } = await supabaseClient.from('warehouse_requests').insert(rows);
  if (error) showSyncError('Could not submit request — check your connection.');
}

async function updateWarehouseRequests(requests) {
  if (!requests.length) return;
  const results = await Promise.all(requests.map((r) => (
    supabaseClient.from('warehouse_requests').update({ status: r.status, qty: r.qty }).eq('id', r.id)
  )));
  if (results.some((r) => r.error)) showSyncError('Could not update request — check your connection.');
}

async function insertKitchenRequests(requests) {
  if (!requests.length) return;
  const rows = requests.map((r) => ({
    id: r.id, ts: r.timestamp, item_name: r.item, qty: r.qty, status: r.status,
  }));
  const { error } = await supabaseClient.from('kitchen_requests').insert(rows);
  if (error) showSyncError('Could not submit request — check your connection.');
}

async function updateKitchenRequests(requests) {
  if (!requests.length) return;
  const results = await Promise.all(requests.map((r) => (
    supabaseClient.from('kitchen_requests').update({ status: r.status, qty: r.qty }).eq('id', r.id)
  )));
  if (results.some((r) => r.error)) showSyncError('Could not update request — check your connection.');
}

async function insertCatalogItem(category, name) {
  const { error } = await supabaseClient.from('items').insert({ category, name });
  if (error) showSyncError('Could not save new item — check your connection.');
}

async function deleteCatalogItem(category, name) {
  const { error } = await supabaseClient.from('items').delete().eq('category', category).eq('name', name);
  if (error) showSyncError('Could not remove item — check your connection.');
}

// Renaming a catalog item cascades across stocks, logs, and both request
// queues (see renameItemEverywhere). mergedStocks carries the post-merge
// quantity for every location that had stock under oldName, so those rows
// can be upserted under newName before the oldName rows are deleted.
async function renameCatalogItemEverywhere(category, oldName, newName, mergedStocks) {
  const tasks = [
    supabaseClient.from('items').update({ name: newName }).eq('category', category).eq('name', oldName),
    supabaseClient.from('stocks').delete().eq('item_name', oldName),
    supabaseClient.from('logs').update({ item_name: newName }).eq('item_name', oldName),
    supabaseClient.from('warehouse_requests').update({ item_name: newName }).eq('item_name', oldName),
    supabaseClient.from('kitchen_requests').update({ item_name: newName }).eq('item_name', oldName),
  ];

  if (mergedStocks.length) {
    const rows = mergedStocks.map(({ location, qty }) => ({ location, item_name: newName, qty }));
    tasks.push(supabaseClient.from('stocks').upsert(rows, { onConflict: 'location,item_name' }));
  }

  const results = await Promise.all(tasks);
  if (results.some((r) => r.error)) showSyncError('Could not fully rename item across all data — check your connection.');
}

// ===================== App Shell / Views =====================

async function enterApp(role) {
  loginScreen.style.display = 'none';

  dataLoadingError.hidden = true;
  dataLoadingRetryBtn.hidden = true;
  dataLoadingStatus.hidden = false;
  dataLoadingOverlay.hidden = false;

  try {
    await loadAllDataFromSupabase();
  } catch (err) {
    dataLoadingStatus.hidden = true;
    dataLoadingError.hidden = false;
    dataLoadingRetryBtn.hidden = false;
    pendingLoginRole = role;
    return;
  }

  dataLoadingOverlay.hidden = true;
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

const STOCK_SOURCE_LABELS = {
  online: 'Online',
  supermarket: 'Supermarket',
};

const WAREHOUSE_SUBTAB_LABELS = {
  general: 'General Inventory',
  kitchen: 'Kitchen',
  shop1: 'Shop 1',
  shop2: 'Shop 2',
  shop3: 'Shop 3',
  shop4: 'Shop 4',
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
  shop4: 'shop4',
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
  insertCatalogItem(category, name);
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
  renameItemEverywhere(category, oldName, newName);
  closeEditItemModal();
  renderView('items');
}

// Item names are stored as plain strings throughout locationStocks, locationLogs,
// and both request queues — renaming a catalog entry must cascade everywhere so
// existing stock and history don't get silently orphaned under the old name.
function renameItemEverywhere(category, oldName, newName) {
  const mergedStocks = [];
  Object.entries(locationStocks).forEach(([location, stock]) => {
    if (Object.prototype.hasOwnProperty.call(stock, oldName)) {
      stock[newName] = (stock[newName] || 0) + stock[oldName];
      delete stock[oldName];
      mergedStocks.push({ location, qty: stock[newName] });
    }
  });

  Object.values(locationLogs).forEach((logs) => {
    logs.forEach((log) => {
      if (log.item === oldName) log.item = newName;
    });
  });

  warehouseRequests.forEach((request) => {
    if (request.item === oldName) request.item = newName;
  });

  kitchenRequests.forEach((request) => {
    if (request.item === oldName) request.item = newName;
  });

  renameCatalogItemEverywhere(category, oldName, newName, mergedStocks);
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
  const itemName = itemsCatalog[category][index];
  itemsCatalog[category].splice(index, 1);
  deleteCatalogItem(category, itemName);
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
  } else if (activeWarehouseSubtab === 'requests') {
    renderAllRequestsSubtab();
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

// Decides which action button(s) a Pending request from a Shop/Kitchen gets:
//   - enough stock      -> Partial + Dispatch + Reject (can choose to send all or less)
//   - some stock, not enough -> Partial + Reject (can only send what's available)
//   - no stock at all   -> Reject only
function buildWarehouseRequestActionButtonsHtml(request) {
  if (request.status !== 'Pending') return '';

  const availableQty = locationStocks.warehouse[request.item] || 0;
  let primaryBtns = '';

  if (availableQty >= request.qty) {
    primaryBtns = `<button type="button" class="partial-dispatch-btn" data-request-id="${request.id}">Partial</button>
                   <button type="button" class="dispatch-request-btn" data-request-id="${request.id}">Dispatch</button>`;
  } else if (availableQty > 0) {
    primaryBtns = `<button type="button" class="partial-dispatch-btn" data-request-id="${request.id}">Partial</button>`;
  }

  return `<div class="request-action-group">
            ${primaryBtns}
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
                  <tr data-status="${escapeHtml(request.status)}">
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

// Consolidated view of every incoming request across all locations, so Warehouse
// staff don't have to hop between per-location subtabs to action them. Includes
// a "Dispatch All Possible" button that sweeps through every Pending request and
// sends whatever it can — fully where stock allows, partially up to the max otherwise.
function renderAllRequestsSubtab() {
  const requests = [...warehouseRequests].sort((a, b) => b.timestamp - a.timestamp);
  const canDispatchAny = requests.some((request) => (
    request.status === 'Pending' && (locationStocks.warehouse[request.item] || 0) > 0
  ));

  warehouseSubtabContent.innerHTML = `
    <div class="all-requests-panel">
      <div class="all-requests-toolbar">
        <h3 class="requests-history-title">Requests from All Locations</h3>
        <button type="button" class="dispatch-all-btn" ${canDispatchAny ? '' : 'disabled'}>Dispatch All Possible</button>
      </div>
      ${requests.length
        ? `<div class="requests-table-wrap">
            <table class="requests-table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th></th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${requests.map((request) => `
                  <tr data-status="${escapeHtml(request.status)}">
                    <td>${escapeHtml(WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation)}</td>
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
        : `<p class="empty-list-msg">No requests yet.</p>`}
    </div>
  `;

  wireIncomingRequestActionListeners(warehouseSubtabContent);

  const dispatchAllBtn = warehouseSubtabContent.querySelector('.dispatch-all-btn');
  if (dispatchAllBtn) dispatchAllBtn.addEventListener('click', handleDispatchAllRequests);
}

// Sweeps every Pending request (oldest first, so earlier requesters get first
// claim on limited stock) and sends whatever the warehouse can spare — fully
// when there's enough, otherwise shrinking the request down to whatever's left,
// mirroring the single-request Dispatch / Send Partial flows.
function handleDispatchAllRequests() {
  const pendingRequests = warehouseRequests
    .filter((request) => request.status === 'Pending')
    .sort((a, b) => a.timestamp - b.timestamp);

  const stock = locationStocks.warehouse;
  const dispatchedRequests = [];
  const stockChanges = new Map();
  const newLogEntries = [];

  pendingRequests.forEach((request) => {
    const availableQty = stock[request.item] || 0;
    if (availableQty <= 0) return;

    const sendQty = roundToTwoDecimals(Math.min(availableQty, request.qty));
    const isPartial = sendQty < request.qty;

    if (isPartial) request.qty = sendQty;
    request.status = 'Dispatched';

    stock[request.item] = roundToTwoDecimals(availableQty - sendQty);
    stockChanges.set(request.item, stock[request.item]);

    const logEntry = {
      timestamp: Date.now(),
      item: request.item,
      actionType: 'subtract',
      qty: sendQty,
      category: getCurrentUserRole(),
      requestTag: isPartial
        ? `Partial dispatch to ${WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation}`
        : `Request from ${WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation}`,
    };
    locationLogs.warehouse.push(logEntry);
    newLogEntries.push(logEntry);

    dispatchedRequests.push(request);
  });

  if (!dispatchedRequests.length) return;

  updateWarehouseRequests(dispatchedRequests);
  upsertStocks('warehouse', Array.from(stockChanges, ([item, qty]) => ({ item, qty })));
  insertLogs('warehouse', newLogEntries);

  rerenderPreservingScroll();
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
        <input type="text" class="warehouse-search-input request-items-search" placeholder="Search items..." autocomplete="off" />
        ${buildRequestQtyTableHtml(locationStocks.kitchen, [{ key: 'processed', label: 'Processed Items' }])}
        <p id="kitchen-request-form-error" class="stock-modal-error" hidden></p>
        <button type="button" class="request-send-all-btn submit-kitchen-request-btn">Request Items</button>
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

  const kitchenRequestFormCard = warehouseSubtabContent.querySelector('.request-form-card');
  const kitchenRequestSearchInput = kitchenRequestFormCard.querySelector('.request-items-search');
  kitchenRequestSearchInput.addEventListener('input', () => filterInventoryRows(kitchenRequestFormCard, kitchenRequestSearchInput));

  kitchenRequestFormCard.querySelector('.submit-kitchen-request-btn').addEventListener('click', () => {
    handleSubmitKitchenRequestTable(kitchenRequestFormCard);
  });
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
  updateWarehouseRequests([request]);

  const stock = locationStocks.warehouse;
  stock[request.item] = (stock[request.item] || 0) - request.qty;
  upsertStocks('warehouse', [{ item: request.item, qty: stock[request.item] }]);

  const logEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: `Request from ${WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation}`,
  };
  locationLogs.warehouse.push(logEntry);
  insertLogs('warehouse', [logEntry]);

  rerenderPreservingScroll();
}

function handleRejectRequest(requestId) {
  const request = warehouseRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  request.status = 'Rejected';
  updateWarehouseRequests([request]);

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

  const fromLabel = WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation;
  const hasFullStock = availableQty >= request.qty;

  pendingPartialDispatch = {
    source: 'warehouse',
    requestId,
    requestedQty: hasFullStock ? request.qty : undefined,
  };

  const infoHtml = hasFullStock
    ? `Warehouse has <strong>${availableQty}</strong> ${escapeHtml(request.item)} available. ${escapeHtml(fromLabel)} requested <strong>${request.qty}</strong>. Enter how many to send — must be less than <strong>${request.qty}</strong>.`
    : `Warehouse only has <strong>${availableQty}</strong> ${escapeHtml(request.item)} in stock, but ${escapeHtml(fromLabel)} requested <strong>${request.qty}</strong>. You can send up to <strong>${availableQty}</strong> now — the rest of the request will be dropped.`;

  openPartialDispatchModalWithInfo(infoHtml, hasFullStock ? request.qty : availableQty);
}

// Mirrors openPartialDispatchModal for the Kitchen side of the flow — Warehouse
// asked Kitchen for processed items, but Kitchen doesn't have enough on hand to
// fulfil the request in full.
function openPartialKitchenDispatchModal(requestId) {
  const request = kitchenRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  const availableQty = locationStocks.kitchen[request.item] || 0;
  if (availableQty <= 0) return;

  const hasFullStock = availableQty >= request.qty;

  pendingPartialDispatch = {
    source: 'kitchen',
    requestId,
    requestedQty: hasFullStock ? request.qty : undefined,
  };

  const infoHtml = hasFullStock
    ? `Kitchen has <strong>${availableQty}</strong> ${escapeHtml(request.item)} available. Warehouse requested <strong>${request.qty}</strong>. Enter how many to send — must be less than <strong>${request.qty}</strong>.`
    : `Kitchen only has <strong>${availableQty}</strong> ${escapeHtml(request.item)} in stock, but Warehouse requested <strong>${request.qty}</strong>. You can send up to <strong>${availableQty}</strong> now — the rest of the request will be dropped.`;

  openPartialDispatchModalWithInfo(infoHtml, hasFullStock ? request.qty : availableQty);
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
// requestedQty is passed when the sender has enough stock — partial must then
// be strictly less than what was requested (Dispatch handles the full amount).
function readPartialDispatchQuantity(availableQty, itemName, requestedQty) {
  const sendQty = Number(partialDispatchQtyInput.value);

  if (!Number.isFinite(sendQty) || sendQty <= 0) {
    return { error: 'Please enter a quantity greater than zero.' };
  }

  if (requestedQty !== undefined && sendQty >= requestedQty) {
    return { error: `Partial must be less than the requested amount (${requestedQty}). Use Dispatch to send the full amount.` };
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
  const result = readPartialDispatchQuantity(availableQty, request.item, pendingPartialDispatch.requestedQty);
  if (result.error) {
    showPartialDispatchError(result.error);
    return;
  }
  const sendQty = result.value;

  request.qty = sendQty;
  request.status = 'Dispatched';
  updateWarehouseRequests([request]);

  stock[request.item] = roundToTwoDecimals(availableQty - sendQty);
  upsertStocks('warehouse', [{ item: request.item, qty: stock[request.item] }]);

  const logEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: sendQty,
    category: getCurrentUserRole(),
    requestTag: `Partial dispatch to ${WAREHOUSE_SUBTAB_LABELS[request.fromLocation] || request.fromLocation}`,
  };
  locationLogs.warehouse.push(logEntry);
  insertLogs('warehouse', [logEntry]);

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
  const result = readPartialDispatchQuantity(availableQty, request.item, pendingPartialDispatch.requestedQty);
  if (result.error) {
    showPartialDispatchError(result.error);
    return;
  }
  const sendQty = result.value;

  request.qty = sendQty;
  request.status = 'Dispatched';
  updateKitchenRequests([request]);

  stock[request.item] = roundToTwoDecimals(availableQty - sendQty);
  locationStocks.warehouse[request.item] = roundToTwoDecimals((locationStocks.warehouse[request.item] || 0) + sendQty);
  upsertStocks('kitchen', [{ item: request.item, qty: stock[request.item] }]);
  upsertStocks('warehouse', [{ item: request.item, qty: locationStocks.warehouse[request.item] }]);

  const kitchenLogEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: sendQty,
    category: getCurrentUserRole(),
    requestTag: 'Partial dispatch to Warehouse',
  };
  const warehouseLogEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'add',
    qty: sendQty,
    category: getCurrentUserRole(),
    requestTag: 'Partial receipt from Kitchen',
  };
  locationLogs.kitchen.push(kitchenLogEntry);
  locationLogs.warehouse.push(warehouseLogEntry);
  insertLogs('kitchen', [kitchenLogEntry]);
  insertLogs('warehouse', [warehouseLogEntry]);

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
          <button type="button" class="warehouse-toolbar-btn" data-inventory-action="export-csv">Export CSV</button>
          <button type="button" class="warehouse-toolbar-btn" data-inventory-action="export-logs">Export Logs (TXT)</button>
        </div>
      </div>

      <div class="inventory-columns">
        ${ITEM_CATEGORIES.map((category) => `
          <section class="inventory-column">
            <h3 class="inventory-column-title">${category.label}</h3>
            ${itemsCatalog[category.key].length
              ? `<div class="inventory-table-wrap">
                  <table class="inventory-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Stock</th>
                        <th>Add</th>
                        <th>Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsCatalog[category.key].map((item) => `
                        <tr class="inventory-row" data-item="${escapeHtml(item)}">
                          <td class="inventory-item-name">${escapeHtml(item)}</td>
                          <td><span class="inventory-item-qty">${stock[item] || 0}</span></td>
                          <td><input type="number" class="batch-qty-input batch-add-input" min="0" step="any" placeholder="–" /></td>
                          <td><input type="number" class="batch-qty-input batch-remove-input" min="0" step="any" placeholder="–" /></td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
                <div class="batch-section-footer">
                  <p class="batch-update-error stock-modal-error" hidden></p>
                  <button type="button" class="update-stock-section-btn" data-category="${category.key}">
                    Update Stock
                  </button>
                </div>`
              : `<p class="empty-list-msg">No items in this category yet.</p>`}
          </section>
        `).join('')}
      </div>

      <section class="inventory-log-feed" id="log-update-history-section">
        <h3 class="inventory-log-title">Log Update History</h3>
        ${renderLogFeedHtml()}
      </section>

      <section class="inventory-log-feed">
        <h3 class="inventory-log-title">Archived Daily Logs</h3>
        ${renderArchivedLogsHtml(locationKey)}
      </section>

      <section class="inventory-log-feed" id="monthly-inventory-sheets-section">
        <h3 class="inventory-log-title">Monthly Inventory Sheets</h3>
        ${renderInventorySheetsHtml(locationKey)}
      </section>
    </div>
  `;

  const searchInput = container.querySelector('.warehouse-search-input');
  searchInput.addEventListener('input', () => filterInventoryRows(container, searchInput));

  container.querySelector('[data-inventory-action="export-csv"]').addEventListener('click', () => {
    container.querySelector('#monthly-inventory-sheets-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  container.querySelector('[data-inventory-action="export-logs"]').addEventListener('click', () => {
    container.querySelector('#log-update-history-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  container.querySelector('.current-day-log-btn').addEventListener('click', handleExportLogs);

  container.querySelectorAll('.update-stock-section-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleBatchUpdateClick(container, btn.dataset.category, locationKey));
  });

  container.querySelectorAll('.archive-download-btn[data-archive-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      downloadLogArchive(Number(btn.dataset.archiveId), btn.dataset.location, btn.dataset.date);
    });
  });

  const currentMonthSheetBtn = container.querySelector('.current-month-sheet-btn');
  if (currentMonthSheetBtn) {
    currentMonthSheetBtn.addEventListener('click', () => {
      currentMonthSheetBtn.disabled = true;
      handleDownloadCurrentMonthSheet(locationKey).finally(() => {
        currentMonthSheetBtn.disabled = false;
      });
    });
  }

  container.querySelectorAll('.sheet-download-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      downloadInventorySheet(Number(btn.dataset.sheetId), btn.dataset.location, btn.dataset.month);
    });
  });
}

// Lists past days' archived logs for a location (see logArchives) — each
// day's logs + that day's requests are cleared by a scheduled Supabase job
// at 5pm and the day's log text is saved here for download.
function renderArchivedLogsHtml(locationKey) {
  const archives = logArchives[locationKey] || [];

  if (!archives.length) {
    return `<p class="empty-list-msg">No archived logs yet.</p>`;
  }

  return `
    <ul class="log-feed-list">
      ${archives.map((archive) => `
        <li class="log-feed-row archive-row">
          <span class="log-feed-time">${escapeHtml(archive.archiveDate)}</span>
          <button type="button" class="archive-download-btn" data-archive-id="${archive.id}" data-location="${locationKey}" data-date="${escapeHtml(archive.archiveDate)}">Download</button>
        </li>
      `).join('')}
    </ul>
  `;
}

// Lists the current month's "so far" sheet (always available, generated on
// demand) plus up to 3 stored past months from inventory_sheets — see
// ensurePreviousMonthSheets.
function renderInventorySheetsHtml(locationKey) {
  const now = new Date();
  const currentMonthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()} (so far)`;
  const sheets = [...(inventorySheets[locationKey] || [])].sort((a, b) => b.sheetMonth.localeCompare(a.sheetMonth));

  return `
    <ul class="log-feed-list">
      <li class="log-feed-row archive-row">
        <span class="log-feed-time">${escapeHtml(currentMonthLabel)}</span>
        <button type="button" class="archive-download-btn current-month-sheet-btn">Download</button>
      </li>
      ${sheets.map((sheet) => {
        const sheetDate = new Date(sheet.sheetMonth);
        const label = `${MONTH_NAMES[sheetDate.getUTCMonth()]} ${sheetDate.getUTCFullYear()}`;
        return `
        <li class="log-feed-row archive-row">
          <span class="log-feed-time">${escapeHtml(label)}</span>
          <button type="button" class="archive-download-btn sheet-download-btn" data-sheet-id="${sheet.id}" data-location="${locationKey}" data-month="${escapeHtml(sheet.sheetMonth)}">Download</button>
        </li>
      `;
      }).join('')}
    </ul>
  `;
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

  const soFarRow = `
    <li class="log-feed-row archive-row">
      <span class="log-feed-time">Today (so far, until 5pm reset)</span>
      <button type="button" class="archive-download-btn current-day-log-btn">Download</button>
    </li>
  `;

  if (!logs.length) {
    return `<ul class="log-feed-list">${soFarRow}</ul><p class="empty-list-msg">No stock updates logged yet.</p>`;
  }

  const sortedLogs = [...logs].sort((a, b) => b.timestamp - a.timestamp);

  return `
    <ul class="log-feed-list">
      ${soFarRow}
      ${sortedLogs.map((log) => `
        <li class="log-feed-row">
          <span class="log-feed-time">${formatLogTimestamp(log.timestamp)}</span>
          <span class="log-feed-detail">
            <strong>${escapeHtml(log.item)}</strong> ${log.actionType === 'add' ? 'added' : 'subtracted'} ${log.qty}
            <span class="log-feed-category">(${escapeHtml(ROLE_LABELS[log.category] || log.category)})</span>
            ${log.requestTag ? `<span class="log-feed-tag">(${escapeHtml(log.requestTag)})</span>` : ''}
            ${log.source ? `<span class="log-feed-note">(${escapeHtml(STOCK_SOURCE_LABELS[log.source] || log.source)})</span>` : ''}
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

// Builds a scrollable "Item | Stock | Request Qty" table per item category,
// mirroring the General Inventory batch-update layout. `stock` is the
// requesting location's own stock (shown for context while deciding how much
// to ask for).
function buildRequestQtyTableHtml(stock, categories) {
  const singleCategory = categories.length === 1 ? ' single-category' : '';

  return `
    <div class="inventory-columns request-items-columns${singleCategory}">
      ${categories.map((category) => `
        <section class="inventory-column">
          <h3 class="inventory-column-title">${category.label}</h3>
          ${itemsCatalog[category.key].length
            ? `<div class="inventory-table-wrap">
                <table class="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Stock</th>
                      <th>Request Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsCatalog[category.key].map((item) => `
                      <tr class="inventory-row" data-item="${escapeHtml(item)}">
                        <td class="inventory-item-name">${escapeHtml(item)}</td>
                        <td><span class="inventory-item-qty">${stock[item] || 0}</span></td>
                        <td><input type="number" class="batch-qty-input request-qty-cell-input" min="0" step="any" placeholder="–" /></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`
            : `<p class="empty-list-msg">No items in this category yet.</p>`}
        </section>
      `).join('')}
    </div>
  `;
}

// Reads every "Request Qty" input inside a request-form-card and returns the
// items with a positive quantity entered.
function collectRequestQtyEntries(formCard) {
  const entries = [];
  formCard.querySelectorAll('.inventory-row').forEach((row) => {
    const qty = Number(row.querySelector('.request-qty-cell-input').value);
    if (Number.isFinite(qty) && qty > 0) {
      entries.push({ item: row.dataset.item, qty });
    }
  });
  return entries;
}

function renderWarehouseRequestsPanel(container, locationKey) {
  const requests = warehouseRequests
    .filter((request) => request.fromLocation === locationKey)
    .sort((a, b) => b.timestamp - a.timestamp);

  container.innerHTML = `
    <div class="warehouse-requests">
      <section class="request-form-card">
        <h3 class="request-form-title">Submit Request to Warehouse</h3>
        <input type="text" class="warehouse-search-input request-items-search" placeholder="Search items..." autocomplete="off" />
        ${buildRequestQtyTableHtml(locationStocks[locationKey], ITEM_CATEGORIES)}
        <p id="warehouse-request-form-error" class="stock-modal-error" hidden></p>
        <button type="button" class="request-send-all-btn submit-warehouse-request-btn">Request Items</button>
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
                    <tr data-status="${escapeHtml(request.status)}">
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

  const requestFormCard = container.querySelector('.request-form-card');
  const requestSearchInput = requestFormCard.querySelector('.request-items-search');
  requestSearchInput.addEventListener('input', () => filterInventoryRows(requestFormCard, requestSearchInput));

  requestFormCard.querySelector('.submit-warehouse-request-btn').addEventListener('click', () => {
    handleSubmitWarehouseRequestTable(requestFormCard, locationKey);
  });

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
  let primaryBtns = '';

  if (availableQty >= request.qty) {
    primaryBtns = `<button type="button" class="partial-dispatch-btn partial-dispatch-kitchen-action-btn" data-request-id="${request.id}">Partial</button>
                   <button type="button" class="dispatch-request-btn dispatch-kitchen-action-btn" data-request-id="${request.id}">Dispatch</button>`;
  } else if (availableQty > 0) {
    primaryBtns = `<button type="button" class="partial-dispatch-btn partial-dispatch-kitchen-action-btn" data-request-id="${request.id}">Partial</button>`;
  }

  return `<div class="request-action-group">
            ${primaryBtns}
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
                  <tr data-status="${escapeHtml(request.status)}">
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

// Reads the "Request Qty" table inside the Submit Request to Warehouse card
// and queues a Pending request for every item with a quantity entered.
function handleSubmitWarehouseRequestTable(formCard, locationKey) {
  const errorEl = formCard.querySelector('#warehouse-request-form-error');
  const entries = collectRequestQtyEntries(formCard);

  if (entries.length === 0) {
    errorEl.textContent = 'Enter a quantity for at least one item.';
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;

  const now = Date.now();
  const newRequests = entries.map((entry, idx) => ({
    id: now + idx,
    timestamp: now + idx,
    fromLocation: locationKey,
    item: entry.item,
    qty: entry.qty,
    status: 'Pending',
  }));
  warehouseRequests.push(...newRequests);
  insertWarehouseRequests(newRequests);

  renderView(currentViewKey);
}

function handleMarkRequestReceived(requestId) {
  const request = warehouseRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Dispatched') return;

  request.status = 'Received';
  updateWarehouseRequests([request]);

  const stock = locationStocks[request.fromLocation];
  stock[request.item] = (stock[request.item] || 0) + request.qty;
  upsertStocks(request.fromLocation, [{ item: request.item, qty: stock[request.item] }]);

  const logEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'add',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: 'Warehouse Request',
  };
  locationLogs[request.fromLocation].push(logEntry);
  insertLogs(request.fromLocation, [logEntry]);

  rerenderPreservingScroll();
}

// Reads the "Request Qty" table inside the Ask Kitchen for Processed Items
// card and queues a Pending request for every item with a quantity entered.
function handleSubmitKitchenRequestTable(formCard) {
  const errorEl = formCard.querySelector('#kitchen-request-form-error');
  const entries = collectRequestQtyEntries(formCard);

  if (entries.length === 0) {
    errorEl.textContent = 'Enter a quantity for at least one item.';
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;

  const now = Date.now();
  const newRequests = entries.map((entry, idx) => ({
    id: now + idx,
    timestamp: now + idx,
    item: entry.item,
    qty: entry.qty,
    status: 'Pending',
  }));
  kitchenRequests.push(...newRequests);
  insertKitchenRequests(newRequests);

  renderView(currentViewKey);
}

function handleDispatchKitchenRequest(requestId) {
  const request = kitchenRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  const kitchenStock = locationStocks.kitchen;
  const availableQty = kitchenStock[request.item] || 0;

  request.status = 'Dispatched';
  updateKitchenRequests([request]);

  kitchenStock[request.item] = availableQty - request.qty;
  locationStocks.warehouse[request.item] = (locationStocks.warehouse[request.item] || 0) + request.qty;
  upsertStocks('kitchen', [{ item: request.item, qty: kitchenStock[request.item] }]);
  upsertStocks('warehouse', [{ item: request.item, qty: locationStocks.warehouse[request.item] }]);

  const kitchenLogEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'subtract',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: 'Dispatched to Warehouse',
  };
  const warehouseLogEntry = {
    timestamp: Date.now(),
    item: request.item,
    actionType: 'add',
    qty: request.qty,
    category: getCurrentUserRole(),
    requestTag: 'Received from Kitchen',
  };
  locationLogs.kitchen.push(kitchenLogEntry);
  locationLogs.warehouse.push(warehouseLogEntry);
  insertLogs('kitchen', [kitchenLogEntry]);
  insertLogs('warehouse', [warehouseLogEntry]);

  rerenderPreservingScroll();
}

function handleRejectKitchenRequest(requestId) {
  const request = kitchenRequests.find((entry) => entry.id === requestId);
  if (!request || request.status !== 'Pending') return;

  request.status = 'Rejected';
  updateKitchenRequests([request]);

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

function getCurrentUserRole() {
  const session = loadSession();
  return session ? session.role : null;
}

function openStockModal() {
  stockItemSearch.value = '';
  stockActionSelect.value = 'add';
  stockQuantityInput.value = '';
  stockSourceSelect.value = '';
  stockSourceField.hidden = !stockUpdateRequiresSource();
  hideStockModalError();
  hideStockSuggestions();

  stockModal.hidden = false;
  stockItemSearch.focus();
}

function stockUpdateRequiresSource() {
  return LOCATION_VIEWS.includes(activeInventoryLocation);
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
  const source = stockSourceSelect.value;

  if (!itemName) {
    showStockModalError('Please select a valid item from the catalog.');
    return;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showStockModalError('Please enter a quantity greater than zero.');
    return;
  }

  if (stockUpdateRequiresSource() && !source) {
    showStockModalError('Please select a source — Online or Supermarket.');
    return;
  }

  const locationKey = activeInventoryLocation;
  const stock = locationStocks[locationKey];

  const currentQty = stock[itemName] || 0;
  stock[itemName] = actionType === 'add'
    ? currentQty + quantity
    : currentQty - quantity;
  upsertStocks(locationKey, [{ item: itemName, qty: stock[itemName] }]);

  const logEntry = {
    timestamp: Date.now(),
    item: itemName,
    actionType,
    qty: quantity,
    category: getCurrentUserRole(),
  };
  if (source) logEntry.source = source;
  locationLogs[locationKey].push(logEntry);
  insertLogs(locationKey, [logEntry]);

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

// Maps a single log entry to its action direction and the counter-party
// location (or 'own' for direct stock edits). Used to split the CSV export
// into per-source columns rather than one flat total.
function classifyLogEntry(log, locationKey) {
  const { requestTag, actionType } = log;

  if (!requestTag) return { action: actionType, source: 'own' };

  if (locationKey === 'warehouse') {
    if (requestTag === 'Received from Kitchen' || requestTag === 'Partial receipt from Kitchen') {
      return { action: actionType, source: 'kitchen' };
    }
    const locationKeys = Object.keys(WAREHOUSE_SUBTAB_LABELS).filter((k) => k !== 'general');
    for (let i = 0; i < locationKeys.length; i += 1) {
      const locKey = locationKeys[i];
      const label = WAREHOUSE_SUBTAB_LABELS[locKey];
      if (requestTag === `Request from ${label}` || requestTag === `Partial dispatch to ${label}`) {
        return { action: actionType, source: locKey };
      }
    }
  } else {
    if (requestTag === 'Warehouse Request' || requestTag === 'Dispatched to Warehouse' || requestTag === 'Partial dispatch to Warehouse') {
      return { action: actionType, source: 'warehouse' };
    }
  }

  return { action: actionType, source: 'own' };
}

// Builds the monthly inventory CSV for `locationKey` / `year`-`month`
// (0-indexed), covering days 1..dayCount.
//
// `activityRows`/`snapshotRows` are rows from daily_item_activity /
// daily_stock_snapshots (already classified by source and finalized as of
// midnight IST — see archive_and_clear_daily / snapshot_end_of_day in
// supabase-monthly-sheets.sql), used for any day before today. If `liveData`
// is provided ({ logs, stocks }), the LAST day (dayCount) is instead built
// from today's live, not-yet-finalized locationLogs/locationStocks via
// classifyLogEntry — used for "current month so far" downloads.
function buildMonthlyCsv(locationKey, year, month, dayCount, activityRows, snapshotRows, liveData) {
  const allItems = [...getCatalogItemNames()].sort((a, b) => a.localeCompare(b));

  // Source breakdown columns differ by location type.
  // Warehouse sees its own updates plus transfers to/from each other location.
  // Kitchen and shops see own updates plus transfers to/from warehouse.
  const sourceCols = locationKey === 'warehouse'
    ? ['own', 'kitchen', 'shop1', 'shop2', 'shop3', 'shop4']
    : ['own', 'warehouse'];

  const sourceColLabels = sourceCols.map((src) => {
    if (src === 'own') return 'Own';
    if (src === 'warehouse') return 'Warehouse';
    return WAREHOUSE_SUBTAB_LABELS[src] || src;
  });

  // Each day contributes: [added sources... | Added Total] + [subtracted sources... | Subtracted Total] + End of Day Total
  const addedCols = [...sourceColLabels, 'Total'];
  const subtractedCols = [...sourceColLabels, 'Total'];
  const totalDataColsPerDay = addedCols.length + subtractedCols.length + 1;

  const initSources = () => {
    const init = {};
    sourceCols.forEach((s) => { init[s] = 0; });
    return init;
  };

  const dailyActivities = [];
  const dailyTotals = [];

  for (let day = 1; day <= dayCount; day += 1) {
    const dateStr = formatLogDate(new Date(year, month, day));
    const activity = new Map();
    const totals = {};

    if (liveData && day === dayCount) {
      // `liveData.logs` is whatever's currently in the `logs` table, which can
      // span into yesterday evening (the daily clear only happens at 5pm) —
      // restrict to today's entries so they aren't double-counted with
      // yesterday's already-finalized daily_item_activity row.
      liveData.logs.forEach((log) => {
        if (formatLogDate(new Date(log.timestamp)) !== dateStr) return;
        if (!activity.has(log.item)) {
          activity.set(log.item, { added: initSources(), subtracted: initSources() });
        }
        const entry = activity.get(log.item);
        const { action, source } = classifyLogEntry(log, locationKey);
        const bucket = action === 'add' ? entry.added : entry.subtracted;
        const targetSource = sourceCols.includes(source) ? source : 'own';
        bucket[targetSource] = (bucket[targetSource] || 0) + log.qty;
      });
      Object.assign(totals, liveData.stocks);
    } else {
      activityRows.forEach((row) => {
        if (row.activity_date !== dateStr) return;
        if (!activity.has(row.item_name)) {
          activity.set(row.item_name, { added: initSources(), subtracted: initSources() });
        }
        const entry = activity.get(row.item_name);
        const targetSource = sourceCols.includes(row.source) ? row.source : 'own';
        entry.added[targetSource] = (entry.added[targetSource] || 0) + Number(row.added);
        entry.subtracted[targetSource] = (entry.subtracted[targetSource] || 0) + Number(row.subtracted);
      });
      snapshotRows.forEach((row) => {
        if (row.activity_date === dateStr) totals[row.item_name] = Number(row.qty);
      });
    }

    dailyActivities.push(activity);
    dailyTotals.push(totals);
  }

  const itemColumns = ['Item Category', 'Item Name'];

  // Three header rows:
  //   Row 1 — date label spanning all data columns for that day
  //   Row 2 — "Added" and "Subtracted" section labels + "End of Day Total"
  //   Row 3 — individual source column names + "Total" + "End of Day Total"
  const dateHeaderRow = itemColumns.map(() => '');
  const sectionHeaderRow = itemColumns.map(() => '');
  const columnHeaderRow = [...itemColumns];

  for (let day = 1; day <= dayCount; day += 1) {
    dateHeaderRow.push(formatOrdinalDateHeader(new Date(year, month, day)), ...Array(totalDataColsPerDay - 1).fill(''));
    sectionHeaderRow.push(
      'Added', ...Array(addedCols.length - 1).fill(''),
      'Subtracted', ...Array(subtractedCols.length - 1).fill(''),
      'End of Day Total',
    );
    columnHeaderRow.push(...addedCols, ...subtractedCols, 'End of Day Total');
  }

  const lines = [];
  lines.push(dateHeaderRow.map(csvEscape).join(','));
  lines.push(sectionHeaderRow.map(csvEscape).join(','));
  lines.push(columnHeaderRow.map(csvEscape).join(','));

  allItems.forEach((item) => {
    const row = [getItemCategoryLabel(item), item];

    for (let day = 1; day <= dayCount; day += 1) {
      const index = day - 1;
      const itemActivity = dailyActivities[index].get(item);
      const totals = dailyTotals[index];
      const endOfDayTotal = totals[item] !== undefined ? totals[item] : 0;

      const addedTotal = sourceCols.reduce((sum, src) => sum + (itemActivity ? itemActivity.added[src] : 0), 0);
      const subtractedTotal = sourceCols.reduce((sum, src) => sum + (itemActivity ? itemActivity.subtracted[src] : 0), 0);

      sourceCols.forEach((src) => row.push(String(itemActivity ? itemActivity.added[src] : 0)));
      row.push(String(addedTotal));

      sourceCols.forEach((src) => row.push(String(itemActivity ? itemActivity.subtracted[src] : 0)));
      row.push(String(subtractedTotal));

      row.push(String(endOfDayTotal));
    }

    lines.push(row.map(csvEscape).join(','));
  });

  return lines.join('\r\n');
}

// Builds the "current month so far" CSV for `locationKey` — days before
// today come from daily_item_activity / daily_stock_snapshots (finalized as
// of midnight IST by snapshot_end_of_day), and today comes from live
// locationLogs / locationStocks (not yet finalized).
async function buildCurrentMonthCsv(locationKey) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayCount = now.getDate();

  let activityRows = [];
  let snapshotRows = [];

  if (dayCount > 1) {
    const monthStart = formatLogDate(new Date(year, month, 1));
    const yesterday = formatLogDate(new Date(year, month, dayCount - 1));

    const [activityRes, snapshotRes] = await Promise.all([
      supabaseClient.from('daily_item_activity').select('item_name, activity_date, source, added, subtracted')
        .eq('location', locationKey).gte('activity_date', monthStart).lte('activity_date', yesterday),
      supabaseClient.from('daily_stock_snapshots').select('item_name, activity_date, qty')
        .eq('location', locationKey).gte('activity_date', monthStart).lte('activity_date', yesterday),
    ]);
    if (activityRes.error || snapshotRes.error) throw activityRes.error || snapshotRes.error;
    activityRows = activityRes.data;
    snapshotRows = snapshotRes.data;
  }

  const liveData = { logs: locationLogs[locationKey], stocks: locationStocks[locationKey] };
  return buildMonthlyCsv(locationKey, year, month, dayCount, activityRows, snapshotRows, liveData);
}

// Generates and stores last month's finished CSV sheet for any location that
// doesn't have one yet (run opportunistically on every load — see
// loadAllDataFromSupabase). Also prunes inventory_sheets down to the 3 most
// recent months. Returns true if anything changed (so the caller can
// re-render to show the new sheet).
async function ensurePreviousMonthSheets() {
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = formatLogDate(prevMonthDate);

  const locations = ['warehouse', 'kitchen', 'shop1', 'shop2', 'shop3', 'shop4'];
  const missing = locations.filter((loc) => !(inventorySheets[loc] || []).some((s) => s.sheetMonth === prevMonthKey));
  if (!missing.length) return false;

  const daysInPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate();
  const monthStart = formatLogDate(prevMonthDate);
  const monthEnd = formatLogDate(new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), daysInPrevMonth));

  const [activityRes, snapshotRes] = await Promise.all([
    supabaseClient.from('daily_item_activity').select('location, item_name, activity_date, source, added, subtracted')
      .gte('activity_date', monthStart).lte('activity_date', monthEnd),
    supabaseClient.from('daily_stock_snapshots').select('location, item_name, activity_date, qty')
      .gte('activity_date', monthStart).lte('activity_date', monthEnd),
  ]);
  if (activityRes.error || snapshotRes.error) return false;

  // No recorded activity/snapshots for that month at all — most likely this
  // feature was only just deployed and there's nothing real to show yet.
  // Skip generating an all-zero sheet; try again next month once data exists.
  if (!activityRes.data.length && !snapshotRes.data.length) return false;

  const rows = missing.map((loc) => ({
    location: loc,
    sheet_month: prevMonthKey,
    content: buildMonthlyCsv(
      loc, prevMonthDate.getFullYear(), prevMonthDate.getMonth(), daysInPrevMonth,
      activityRes.data.filter((r) => r.location === loc),
      snapshotRes.data.filter((r) => r.location === loc),
      null,
    ),
  }));

  const { error: upsertError } = await supabaseClient.from('inventory_sheets').upsert(rows, { onConflict: 'location,sheet_month' });
  if (upsertError) return false;

  // Keep only the 3 most recent months (this one + 2 older).
  const cutoff = formatLogDate(new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() - 2, 1));
  await supabaseClient.from('inventory_sheets').delete().lt('sheet_month', cutoff);

  const { data, error } = await supabaseClient.from('inventory_sheets').select('id, location, sheet_month').order('sheet_month', { ascending: false });
  if (error) return false;

  const sheets = buildDefaultLocationLogs();
  data.forEach((row) => {
    if (!sheets[row.location]) sheets[row.location] = [];
    sheets[row.location].push({ id: row.id, sheetMonth: row.sheet_month });
  });
  inventorySheets = sheets;

  return true;
}

// Fetches one stored monthly sheet's CSV text on demand and triggers a
// download.
async function downloadInventorySheet(id, location, sheetMonth) {
  const { data, error } = await supabaseClient.from('inventory_sheets').select('content').eq('id', id).single();
  if (error || !data) {
    showSyncError('Could not download sheet — check your connection.');
    return;
  }
  downloadTextFile(`puchkas-inventory-${location}-${sheetMonth.slice(0, 7)}.csv`, data.content, 'text/csv;charset=utf-8;');
}

// Builds and downloads the current month's CSV "so far" for `locationKey`.
async function handleDownloadCurrentMonthSheet(locationKey) {
  try {
    const csv = await buildCurrentMonthCsv(locationKey);
    const now = new Date();
    const filename = `puchkas-inventory-${locationKey}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.csv`;
    downloadTextFile(filename, csv, 'text/csv;charset=utf-8;');
  } catch {
    showSyncError('Could not generate sheet — check your connection.');
  }
}

function buildInventoryLogText() {
  const sortedLogs = [...locationLogs[activeInventoryLocation]].sort((a, b) => a.timestamp - b.timestamp);

  return sortedLogs
    .map((log) => {
      const roleLabel = (ROLE_LABELS[log.category] || log.category || '').toUpperCase();
      const action = log.actionType === 'add' ? 'Added' : 'Subtracted';
      const sourceSuffix = log.source ? ` — ${STOCK_SOURCE_LABELS[log.source] || log.source}` : '';
      return `[${formatLogTimestamp(log.timestamp)}] ${roleLabel}: ${action} ${log.qty} ${log.item}${sourceSuffix}`;
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

function handleBatchUpdateClick(container, categoryKey, locationKey) {
  const section = container.querySelector(`[data-category="${categoryKey}"]`).closest('.inventory-column');
  const errorEl = section.querySelector('.batch-update-error');
  const stock = locationStocks[locationKey];

  // Clear previous error state
  section.querySelectorAll('.inventory-row').forEach((row) => row.classList.remove('invalid-batch-row'));
  errorEl.hidden = true;

  const changes = [];
  let hasConflict = false;
  let hasInvalid = false;

  section.querySelectorAll('.inventory-row').forEach((row) => {
    const item = row.dataset.item;
    const addQty = Number(row.querySelector('.batch-add-input').value) || 0;
    const removeQty = Number(row.querySelector('.batch-remove-input').value) || 0;

    if (addQty > 0 && removeQty > 0) {
      row.classList.add('invalid-batch-row');
      hasConflict = true;
      return;
    }
    if (addQty > 0) {
      changes.push({ item, actionType: 'add', qty: addQty });
    }
    if (removeQty > 0) {
      const currentStock = stock[item] || 0;
      if (removeQty > currentStock) {
        row.classList.add('invalid-batch-row');
        hasInvalid = true;
      } else {
        changes.push({ item, actionType: 'subtract', qty: removeQty });
      }
    }
  });

  if (hasConflict) {
    errorEl.textContent = 'Highlighted rows have both Add and Remove filled — use only one per item.';
    errorEl.hidden = false;
    return;
  }
  if (hasInvalid) {
    errorEl.textContent = 'Highlighted rows cannot be removed — quantity exceeds current stock.';
    errorEl.hidden = false;
    return;
  }
  if (changes.length === 0) return;

  pendingBatchUpdate = { locationKey, changes };

  if (stockUpdateRequiresSource()) {
    batchSourceSelect.value = '';
    batchSourceError.hidden = true;
    batchSourceModal.hidden = false;
  } else {
    applyBatchUpdate(null);
  }
}

function applyBatchUpdate(source) {
  if (!pendingBatchUpdate) return;

  const { locationKey, changes } = pendingBatchUpdate;
  const stock = locationStocks[locationKey];
  const now = Date.now();

  const stockChanges = new Map();
  const newLogEntries = [];

  changes.forEach((change, idx) => {
    const currentQty = stock[change.item] || 0;
    stock[change.item] = change.actionType === 'add'
      ? roundToTwoDecimals(currentQty + change.qty)
      : roundToTwoDecimals(currentQty - change.qty);
    stockChanges.set(change.item, stock[change.item]);

    const logEntry = {
      timestamp: now + idx,
      item: change.item,
      actionType: change.actionType,
      qty: change.qty,
      category: getCurrentUserRole(),
    };
    if (source) logEntry.source = source;
    locationLogs[locationKey].push(logEntry);
    newLogEntries.push(logEntry);
  });

  upsertStocks(locationKey, Array.from(stockChanges, ([item, qty]) => ({ item, qty })));
  insertLogs(locationKey, newLogEntries);
  pendingBatchUpdate = null;
  renderView(currentViewKey);
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

batchSourceConfirmBtn.addEventListener('click', () => {
  const source = batchSourceSelect.value;
  if (!source) {
    batchSourceError.textContent = 'Please select a source.';
    batchSourceError.hidden = false;
    return;
  }
  batchSourceModal.hidden = true;
  applyBatchUpdate(source);
});
batchSourceCancelBtn.addEventListener('click', () => {
  batchSourceModal.hidden = true;
  pendingBatchUpdate = null;
});

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

dataLoadingRetryBtn.addEventListener('click', () => {
  if (pendingLoginRole) enterApp(pendingLoginRole);
});

refreshDataBtn.addEventListener('click', async () => {
  refreshDataBtn.disabled = true;
  try {
    await loadAllDataFromSupabase();
    rerenderPreservingScroll();
  } catch (err) {
    showSyncError('Could not refresh data — check your connection.');
  } finally {
    refreshDataBtn.disabled = false;
  }
});

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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
