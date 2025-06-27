// PyPhone - Main JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Kiểm tra xem pywebview đã sẵn sàng chưa
    function checkPywebviewReady() {
        if (window.pywebview && typeof window.pywebview === 'object') {
            // Nếu pywebview đã sẵn sàng, khởi tạo ứng dụng
            initApplication();
        } else {
            // Nếu chưa sẵn sàng, thử lại sau 100ms
            setTimeout(checkPywebviewReady, 100);
        }
    }

    // Bắt đầu kiểm tra
    checkPywebviewReady();
});

// Global state
const state = {
    devices: [],
    scripts: [],
    selectedDevice: null,
    selectedScript: null,
    selectedDevicesForScript: [],
    runningScripts: {},
    logPollingIntervals: {},
    lastScriptConfig: {} // Lưu trữ cấu hình cuối cùng của mỗi script
};

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Add appropriate icon
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';
    if (type === 'error') icon = 'fa-times-circle';

    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icon}"></i></div>
        <div class="toast-message">${message}</div>
    `;

    toastContainer.appendChild(toast);

    // Remove toast after a delay
    setTimeout(() => {
        toast.classList.add('toast-hiding');
        setTimeout(() => {
            if (toast.parentNode === toastContainer) {
                toastContainer.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

/**
 * Format a key string into a readable label
 */
function formatLabel(key) {
    // Convert camelCase or snake_case to Title Case with spaces
    return key
        .replace(/([A-Z])/g, ' $1') // Insert space before capital letters
        .replace(/_/g, ' ') // Replace underscores with spaces
        .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
        .trim();
}

/**
 * Clear script logs for a specific device
 */
async function clearScriptLogs(deviceSerial) {
    try {
        const result = await window.pywebview.api.clear_script_logs(deviceSerial);

        if (result.error) {
            showToast(`Lỗi khi xoá log: ${result.error}`, 'error');
            return;
        }

        document.getElementById('script-logs').innerHTML = '<div class="placeholder">Log đã được xoá</div>';
        showToast('Đã xoá log', 'success');
    } catch (error) {
        console.error('Error clearing logs:', error);
        showToast(`Lỗi khi xoá log: ${error.message || error}`, 'error');
    }
}

/**
 * Display script logs in the log container
 */
function displayScriptLogs(logs, container) {
    container.innerHTML = '';
    logs.forEach(log => {
        const logLine = document.createElement('div');
        logLine.className = 'log-line';

        // Check log type and apply appropriate styling
        if (log.includes('Error:') || log.includes('Lỗi:')) {
            logLine.classList.add('log-error');
        }
        else if (log.includes('Warning:') || log.includes('Cảnh báo:')) {
            logLine.classList.add('log-warning');
        }
        else if (log.includes('Success:') || log.includes('Thành công:') || log.includes('completed')) {
            logLine.classList.add('log-success');
        }

        logLine.textContent = log;
        container.appendChild(logLine);
    });

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

/**
 * Refresh script logs for a specific device
 */
async function refreshScriptLogs(deviceSerial) {
    try {
        const result = await window.pywebview.api.get_script_logs(deviceSerial);
        const logsContainer = document.getElementById('script-logs');

        if (result.error) {
            logsContainer.innerHTML = `<div class="placeholder">${result.error}</div>`;
            return;
        }

        if (!result.logs || result.logs.length === 0) {
            logsContainer.innerHTML = '<div class="placeholder">Không có log nào</div>';
            return;
        }

        displayScriptLogs(result.logs, logsContainer);
    } catch (error) {
        console.error('Error refreshing logs:', error);
        document.getElementById('script-logs').innerHTML = `<div class="error">Lỗi khi tải log: ${error.message || error}</div>`;
    }
}

/**
 * Refresh logs for the currently selected device
 */
function refreshCurrentDeviceLogs() {
    const deviceSelector = document.getElementById('log-device-selector');
    if (deviceSelector.value) {
        refreshScriptLogs(deviceSelector.value);
    }
}

/**
 * Setup log viewer for the first running device
 */
function setupLogViewerForRunningDevice() {
    if (state.selectedDevicesForScript.length > 0) {
        const deviceSelector = document.getElementById('log-device-selector');
        deviceSelector.value = state.selectedDevicesForScript[0];
        deviceSelector.dispatchEvent(new Event('change'));
    }
}

/**
 * Collect script configuration from the form
 */
function collectScriptConfig() {
    const config = {};
    const form = document.getElementById('script-config-form');

    if (form) {
        // Handle different input types
        form.querySelectorAll('input, select').forEach(input => {
            if (input.name) {
                if (input.type === 'checkbox') {
                    config[input.name] = input.checked;
                } else if (input.type === 'radio') {
                    if (input.checked) {
                        config[input.name] = input.value;
                    }
                } else if (input.type === 'number' || input.type === 'range') {
                    // Ensure values are properly converted to numbers
                    config[input.name] = parseFloat(input.value);
                } else {
                    config[input.name] = input.value;
                }
            }
        });
    }

    return config;
}

/**
 * Reset script configuration to defaults
 */
function resetScriptConfig() {
    if (!state.selectedScript) {
        showToast('Chưa chọn kịch bản', 'warning');
        return;
    }

    const form = document.getElementById('script-config-form');
    if (form) {
        const config = state.selectedScript.config.config;

        // Reset each input to default value
        for (const [key, cfg] of Object.entries(config)) {
            const input = form.querySelector(`#config-${key}, input[name="${key}"]`);

            if (input) {
                if (input.type === 'checkbox' || input.classList.contains('switch-input')) {
                    input.checked = cfg.default;
                } else if (input.type === 'radio') {
                    const radio = form.querySelector(`input[name="${key}"][value="${cfg.default}"]`);
                    if (radio) radio.checked = true;
                } else if (input.type === 'select-one') {
                    input.value = cfg.default;
                } else if (input.type === 'range') {
                    input.value = cfg.default;
                    const valueDisplay = input.nextElementSibling;
                    if (valueDisplay) valueDisplay.textContent = cfg.default;
                } else {
                    input.value = cfg.default;
                }
            }
        }

        showToast('Đã khôi phục cấu hình mặc định', 'success');
    }
}

/**
 * Save script configuration
 */
function saveScriptConfig() {
    if (!state.selectedScript) {
        showToast('Chưa chọn kịch bản', 'warning');
        return;
    }

    const form = document.getElementById('script-config-form');
    if (form) {
        // Get current config structure
        const currentConfig = state.selectedScript.config.config;
        const config = {};

        // Clone the current config structure
        for (const [key, cfg] of Object.entries(currentConfig)) {
            config[key] = {...cfg};
        }

        // Update with form values - properly handling range inputs
        form.querySelectorAll('input, select').forEach(input => {
            const name = input.name;

            if (name && name in config) {
                if (input.type === 'checkbox') {
                    config[name].value = input.checked;
                } else if (input.type === 'radio') {
                    if (input.checked) {
                        config[name].value = input.value;
                    }
                } else if (input.type === 'number' || input.type === 'range') {
                    // Convert to number and maintain type
                    config[name].value = parseFloat(input.value);
                } else {
                    config[name].value = input.value;
                }
            }
        });

        // Save in local state
        state.lastScriptConfig[state.selectedScript.name] = config;

        // Send to backend and ensure the complete config object is sent
        window.pywebview.api.save_script_config(state.selectedScript.name, config);
        showToast('Đã lưu cấu hình kịch bản', 'success');
    }
}

/**
 * Display stored values in config form - New helper function
 */
function displayConfigValues(config) {
    const form = document.getElementById('script-config-form');
    if (!form) return;

    for (const [key, cfg] of Object.entries(config)) {
        const input = form.querySelector(`#config-${key}, input[name="${key}"]`);

        if (input) {
            const value = cfg.value !== undefined ? cfg.value : cfg.default;

            if (input.type === 'checkbox' || input.classList.contains('switch-input')) {
                input.checked = value;
            } else if (input.type === 'radio') {
                const radio = form.querySelector(`input[name="${key}"][value="${value}"]`);
                if (radio) radio.checked = true;
            } else if (input.type === 'select-one') {
                input.value = value;
            } else if (input.type === 'range') {
                input.value = value;
                // Update the range value display
                const valueDisplay = input.nextElementSibling;
                if (valueDisplay) valueDisplay.textContent = value;
            } else {
                input.value = value;
            }
        }
    }
}

/**
 * Create a form group for a configuration item
 */
function createConfigFormGroup(key, cfg) {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';

    // Create label
    const label = document.createElement('label');
    label.textContent = cfg.label || formatLabel(key);
    label.htmlFor = `config-${key}`;

    // Add description tooltip if available
    if (cfg.description) {
        const tooltip = document.createElement('span');
        tooltip.className = 'config-tooltip';
        tooltip.innerHTML = `<i class="fas fa-info-circle"></i>`;
        tooltip.title = cfg.description;
        label.appendChild(tooltip);
    }

    formGroup.appendChild(label);

    // Create input based on type
    let input;
    switch (cfg.type) {
        case 'checkbox':
            const checkboxContainer = document.createElement('div');
            checkboxContainer.className = 'checkbox-container';

            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `config-${key}`;
            input.name = key;
            input.checked = cfg.value !== undefined ? cfg.value : cfg.default;

            const checkboxLabel = document.createElement('span');
            checkboxLabel.className = 'checkbox-label';

            // Thêm text label cho checkbox để hiển thị tên bên cạnh
            const checkboxText = document.createElement('span');
            checkboxText.textContent = ' ' + (cfg.label || formatLabel(key));

            checkboxContainer.appendChild(input);
            checkboxContainer.appendChild(checkboxLabel);
            checkboxContainer.appendChild(checkboxText);

            // Xử lý sự kiện click trên container
            checkboxContainer.addEventListener('click', function(e) {
                // Nếu không click trực tiếp vào input (vì input đã ẩn)
                if (e.target !== input) {
                    input.checked = !input.checked;
                    // Kích hoạt sự kiện change để cập nhật UI
                    input.dispatchEvent(new Event('change'));
                }
            });

            formGroup.appendChild(checkboxContainer);
            break;

        case 'radio':
            input = document.createElement('div');
            input.className = 'radio-group';

            if (cfg.options && Array.isArray(cfg.options)) {
                cfg.options.forEach(option => {
                    const radioContainer = document.createElement('div');
                    radioContainer.className = 'radio-option';

                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.id = `config-${key}-${option}`;
                    radio.name = key;
                    radio.value = option;
                    radio.checked = (cfg.value !== undefined ? cfg.value : cfg.default) === option;

                    const radioLabel = document.createElement('label');
                    radioLabel.textContent = option;
                    radioLabel.htmlFor = `config-${key}-${option}`;

                    radioContainer.appendChild(radio);
                    radioContainer.appendChild(radioLabel);
                    input.appendChild(radioContainer);
                });
            }
            formGroup.appendChild(input);
            break;

        case 'switch':
            const switchWrapper = document.createElement('div');
            switchWrapper.className = 'switch-wrapper';

            const switchContainer = document.createElement('div');
            switchContainer.className = 'switch-container';

            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `config-${key}`;
            input.name = key;
            input.className = 'switch-input';
            input.checked = cfg.value !== undefined ? cfg.value : cfg.default;

            const switchLabel = document.createElement('label');
            switchLabel.className = 'switch-label';
            switchLabel.htmlFor = `config-${key}`;

            // Thêm text label cho switch
            const switchText = document.createElement('span');
            switchText.className = 'switch-text';
            switchText.textContent = input.checked ? 'Bật' : 'Tắt';

            // Cập nhật text khi thay đổi trạng thái
            input.addEventListener('change', function() {
                switchText.textContent = input.checked ? 'Bật' : 'Tắt';
            });

            switchContainer.appendChild(input);
            switchContainer.appendChild(switchLabel);
            switchWrapper.appendChild(switchContainer);
            switchWrapper.appendChild(switchText);

            formGroup.appendChild(switchWrapper);
            break;

        case 'select':
            input = document.createElement('select');
            input.id = `config-${key}`;
            input.name = key;
            input.className = 'select-input';

            if (cfg.options && Array.isArray(cfg.options)) {
                cfg.options.forEach(option => {
                    const optionElement = document.createElement('option');
                    if (typeof option === 'object' && option.value !== undefined) {
                        optionElement.value = option.value;
                        optionElement.textContent = option.label || option.value;
                    } else {
                        optionElement.value = option;
                        optionElement.textContent = option;
                    }

                    const currentValue = cfg.value !== undefined ? cfg.value : cfg.default;
                    optionElement.selected = optionElement.value == currentValue;

                    input.appendChild(optionElement);
                });
            }
            formGroup.appendChild(input);
            break;

        case 'number':
            input = document.createElement('input');
            input.type = 'number';
            input.id = `config-${key}`;
            input.name = key;
            input.value = cfg.value !== undefined ? cfg.value : cfg.default;
            input.step = cfg.step || 1;
            if (cfg.min !== undefined) input.min = cfg.min;
            if (cfg.max !== undefined) input.max = cfg.max;

            formGroup.appendChild(input);
            break;

        case 'range':
            const rangeContainer = document.createElement('div');
            rangeContainer.className = 'range-container';

            input = document.createElement('input');
            input.type = 'range';
            input.id = `config-${key}`;
            input.name = key;
            input.className = 'range-input';

            if (cfg.min !== undefined) input.min = cfg.min;
            if (cfg.max !== undefined) input.max = cfg.max;
            input.step = cfg.step || 1;

            const rangeValue = cfg.value !== undefined ? cfg.value : cfg.default;
            input.value = rangeValue;

            const rangeValueDisplay = document.createElement('span');
            rangeValueDisplay.className = 'range-value';
            rangeValueDisplay.textContent = input.value;

            // Update range value display when slider is moved
            input.addEventListener('input', () => {
                rangeValueDisplay.textContent = input.value;
                console.log(`Range ${key} changed to: ${input.value}`);
            });

            rangeContainer.appendChild(input);
            rangeContainer.appendChild(rangeValueDisplay);
            formGroup.appendChild(rangeContainer);
            break;

        case 'text':
        default:
            input = document.createElement('input');
            input.type = 'text';
            input.id = `config-${key}`;
            input.name = key;
            input.value = cfg.value !== undefined ? cfg.value : cfg.default;

            formGroup.appendChild(input);
            break;
    }

    return formGroup;
}

/**
 * Create a script item element for the UI
 */
function createScriptItem(script) {
    const scriptItem = document.createElement('div');
    scriptItem.className = 'list-item script-item';
    scriptItem.innerHTML = `
        <div class="script-icon"><i class="fas fa-code"></i></div>
        <div class="script-info">
            <div class="script-name">${script.name}</div>
            <div class="script-description">${script.config.description || 'Không có mô tả'}</div>
        </div>
    `;

    // Click event to select script
    scriptItem.addEventListener('click', () => {
        // Remove selected class from all scripts
        document.querySelectorAll('.script-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Add selected class to this script
        scriptItem.classList.add('selected');

        // Update selected script
        selectScript(script);
    });

    return scriptItem;
}

/**
 * Refresh the list of available scripts
 */
async function refreshScriptsList() {
    const scriptsList = document.getElementById('scripts-list');
    scriptsList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Đang tải danh sách kịch bản...</div>';

    try {
        const scripts = await window.pywebview.api.get_scripts();
        state.scripts = scripts;

        if (scripts.length === 0) {
            scriptsList.innerHTML = '<div class="placeholder">Không có kịch bản nào</div>';
            return;
        }

        // Render scripts list
        scriptsList.innerHTML = '';
        scripts.forEach(script => {
            const scriptItem = createScriptItem(script);
            scriptsList.appendChild(scriptItem);
        });

        showToast('Đã cập nhật danh sách kịch bản', 'success');
    } catch (error) {
        console.error('Error refreshing scripts:', error);
        scriptsList.innerHTML = `<div class="error">Lỗi khi tải danh sách kịch bản: ${error.message || error}</div>`;
        showToast('Lỗi khi tải danh sách kịch bản', 'error');
    }
}

/**
 * Execute an action on the selected device
 */
async function executeDeviceAction(action, params) {
    if (!state.selectedDevice) {
        showToast('Chưa chọn thiết bị', 'warning');
        return;
    }

    try {
        const result = await window.pywebview.api.device_action(state.selectedDevice, action, params);

        if (result.error) {
            showToast(`Lỗi: ${result.error}`, 'error');
            document.getElementById('xpath-result').innerHTML = `<div class="error">${result.error}</div>`;
            return;
        }

        // Handle specific actions
        if (action === 'screenshot') {
            if (result.image) {
                document.getElementById('device-screenshot').src = `data:image/png;base64,${result.image}`;
                document.getElementById('screenshot-container').classList.remove('hidden');
                showToast('Đã chụp ảnh màn hình', 'success');
            }
        } else if (action === 'check_xpath' || action === 'click_xpath') {
            document.getElementById('xpath-result').innerHTML = `
                <div class="result ${result.exists || result.clicked ? 'success' : 'error'}">
                    <i class="fas ${result.exists || result.clicked ? 'fa-check' : 'fa-times'}"></i>
                    ${result.message}
                </div>
            `;
        } else {
            showToast(result.message || 'Đã thực hiện hành động', 'success');
        }
    } catch (error) {
        console.error(`Error executing action ${action}:`, error);
        showToast(`Lỗi khi thực hiện hành động: ${error.message || error}`, 'error');
    }
}

/**
 * Display device information in the UI
 */
function displayDeviceInfo(info) {
    const infoContent = document.getElementById('device-info-content');

    // Format device info into categories
    const categories = {
        "Thông tin cơ bản": ["brand", "model", "device", "version", "sdk"],
        "Màn hình": ["displayWidth", "displayHeight", "displayRotation", "statusBarHeight"],
        "Hệ thống": ["serialno", "cpu", "memory", "batteryLevel", "wifiName"]
    };

    let infoHTML = '';

    for (const [category, keys] of Object.entries(categories)) {
        infoHTML += `<div class="info-category"><h4>${category}</h4>`;

        let categoryContent = '';
        keys.forEach(key => {
            if (info[key] !== undefined) {
                categoryContent += `
                    <div class="info-item">
                        <div class="info-label">${formatLabel(key)}</div>
                        <div class="info-value">${info[key]}</div>
                    </div>
                `;
            }
        });

        if (categoryContent) {
            infoHTML += categoryContent;
        } else {
            infoHTML += `<div class="info-item"><em>Không có thông tin</em></div>`;
        }

        infoHTML += '</div>';
    }

    // Add other info that might not be categorized
    let otherInfo = '';
    for (const [key, value] of Object.entries(info)) {
        if (key !== 'error' && typeof value !== 'object' && !Object.values(categories).flat().includes(key)) {
            otherInfo += `
                <div class="info-item">
                    <div class="info-label">${formatLabel(key)}</div>
                    <div class="info-value">${value}</div>
                </div>
            `;
        }
    }

    if (otherInfo) {
        infoHTML += `<div class="info-category"><h4>Thông tin khác</h4>${otherInfo}</div>`;
    }

    infoContent.innerHTML = infoHTML;
}

/**
 * Show device details view
 */
async function showDeviceDetails(serial) {
    state.selectedDevice = serial;

    // Hide devices list and show device details
    document.getElementById('devices-list').classList.add('hidden');
    document.getElementById('device-details').classList.remove('hidden');

    // Set device title
    const device = state.devices.find(d => d.serial === serial);
    document.getElementById('device-title').textContent = `${device.model} (${serial})`;

    // Display loading state
    document.getElementById('device-info-content').innerHTML = `
        <div class="loading"><i class="fas fa-spinner fa-spin"></i> Đang tải thông tin thiết bị...</div>
    `;

    // Get device info
    try {
        const info = await window.pywebview.api.get_device_info(serial);

        if (info.error) {
            document.getElementById('device-info-content').innerHTML = `<div class="error">${info.error}</div>`;
            return;
        }

        displayDeviceInfo(info);

        // Take an initial screenshot
        executeDeviceAction('screenshot');
    } catch (error) {
        console.error('Error getting device info:', error);
        document.getElementById('device-info-content').innerHTML = `<div class="error">Lỗi: ${error.message || error}</div>`;
        showToast('Lỗi khi tải thông tin thiết bị', 'error');
    }
}

/**
 * Get appropriate battery icon based on battery level
 */
function getBatteryIcon(batteryLevel) {
    if (batteryLevel >= 90) return 'fa-battery-full';
    if (batteryLevel >= 60) return 'fa-battery-three-quarters';
    if (batteryLevel >= 40) return 'fa-battery-half';
    if (batteryLevel >= 10) return 'fa-battery-quarter';
    return 'fa-battery-empty';
}

/**
 * Create a device card element for the UI
 */
function createDeviceCard(device) {
    const deviceCard = document.createElement('div');
    deviceCard.className = `device-card ${device.status === 'Connected' ? '' : 'disconnected'}`;

    // Add status icon
    let statusIcon = device.status === 'Connected' ? 'fa-circle-check' : 'fa-circle-exclamation';
    let statusClass = device.status === 'Connected' ? 'status-connected' : 'status-disconnected';
    let batteryIcon = getBatteryIcon(device.battery || 0);

    deviceCard.innerHTML = `
        <div class="device-header">
            <div class="device-model">${device.model || 'Không xác định'}</div>
            <div class="device-status ${statusClass}">
                <i class="fas ${statusIcon}"></i>
            </div>
        </div>
        <div class="device-body">
            <div class="device-icon">
                <i class="fas fa-mobile-alt"></i>
            </div>
            <div class="device-info">
                <div class="device-serial">${device.serial}</div>
                <div class="device-details-row">
                    <span class="device-brand">${device.brand || 'Không xác định'}</span>
                    ${device.battery ? `
                    <span class="device-battery">
                        <i class="fas ${batteryIcon}"></i>
                        ${device.battery}%
                    </span>` : ''}
                </div>
            </div>
        </div>
        ${device.running ? '<div class="device-badge running">Đang chạy</div>' : ''}
    `;

    // Click event to show device details
    deviceCard.addEventListener('click', () => {
        showDeviceDetails(device.serial);
    });

    return deviceCard;
}

/**
 * Update start script button state based on selection
 */
function updateStartScriptButton() {
    const startButton = document.getElementById('start-script');
    const stopButton = document.getElementById('stop-script');

    startButton.disabled = !state.selectedScript || state.selectedDevicesForScript.length === 0;

    // Check if any selected devices are running scripts
    const anyRunning = state.selectedDevicesForScript.some(serial => {
        const device = state.devices.find(d => d.serial === serial);
        return device && device.running;
    });

    stopButton.disabled = !anyRunning;
}

/**
 * Select a script and update the UI
 */
function selectScript(script) {
    state.selectedScript = script;

    // Update script info
    const scriptInfo = document.getElementById('script-info');
    scriptInfo.innerHTML = `
        <h3>${script.name}</h3>
        <div class="script-description">${script.config.description || 'Không có mô tả'}</div>
    `;

    // Update script config
    const configSection = document.getElementById('script-config-section');
    const configContainer = document.getElementById('script-config');

    const config = script.config.config;
    if (Object.keys(config).length > 0) {
        configSection.classList.remove('hidden');
        configContainer.innerHTML = '';

        // Create form for configuration
        const form = document.createElement('form');
        form.id = 'script-config-form';
        form.className = 'config-form';

        // Generate form controls for each config item
        for (const [key, cfg] of Object.entries(config)) {
            const formGroup = createConfigFormGroup(key, cfg);
            form.appendChild(formGroup);
        }

        configContainer.appendChild(form);

        // Apply saved values if available
        if (state.lastScriptConfig[script.name]) {
            displayConfigValues(state.lastScriptConfig[script.name]);
        }

        // Display config controls
        document.getElementById('config-controls').classList.remove('hidden');
    } else {
        configSection.classList.add('hidden');
        document.getElementById('config-controls').classList.add('hidden');
    }

    // Enable start script button if devices are selected
    updateStartScriptButton();
}

/**
 * Update selected devices for script execution
 */
function updateSelectedDevicesForScript() {
    const checkboxes = document.querySelectorAll('#device-selection-list .device-checkbox:checked');
    state.selectedDevicesForScript = Array.from(checkboxes).map(cb => cb.value);

    // Update start script button
    updateStartScriptButton();
}

/**
 * Update log device selector with available devices
 */
function updateLogDeviceSelector() {
    const selector = document.getElementById('log-device-selector');
    selector.innerHTML = '<option value="" disabled selected>Chọn thiết bị</option>';

    // Add connected devices to selector
    state.devices.forEach(device => {
        if (device.status === 'Connected') {
            const option = document.createElement('option');
            option.value = device.serial;
            option.textContent = `${device.model} (${device.serial})`;
            selector.appendChild(option);
        }
    });
}

/**
 * Update device selection list in scripts tab
 */
function updateDeviceSelectionList() {
    const deviceSelectionList = document.getElementById('device-selection-list');

    if (state.devices.length === 0) {
        deviceSelectionList.innerHTML = '<div class="placeholder">Không có thiết bị khả dụng</div>';
        return;
    }

    // Render device selection list
    deviceSelectionList.innerHTML = '';
    state.devices.forEach(device => {
        if (device.status === 'Connected') {
            const deviceItem = document.createElement('div');
            deviceItem.className = 'list-item device-selection-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'device-checkbox';
            checkbox.value = device.serial;
            checkbox.id = `device-select-${device.serial}`;

            // Check if this device is already selected
            if (state.selectedDevicesForScript.includes(device.serial)) {
                checkbox.checked = true;
            }

            // Add change event to update selected devices
            checkbox.addEventListener('change', updateSelectedDevicesForScript);

            const label = document.createElement('label');
            label.htmlFor = `device-select-${device.serial}`;
            label.innerHTML = `
                <div class="device-icon"><i class="fas fa-mobile-alt"></i></div>
                <div class="device-info">
                    <div class="device-name">${device.model}</div>
                    <div class="device-serial">${device.serial}</div>
                </div>
                ${device.running ? '<div class="device-badge running">Đang chạy</div>' : ''}
            `;

            deviceItem.appendChild(checkbox);
            deviceItem.appendChild(label);

            deviceSelectionList.appendChild(deviceItem);
        }
    });

    // Update log device selector
    updateLogDeviceSelector();
}

/**
 * Update status bar with connection information
 */
function updateStatusBar() {
    const statusDevices = document.getElementById('status-devices');
    const connectedCount = state.devices.filter(d => d.status === 'Connected').length;
    const runningCount = state.devices.filter(d => d.running).length;

    if (connectedCount === 0) {
        statusDevices.textContent = 'Không có thiết bị nào được kết nối';
    } else {
        statusDevices.textContent = `Đã kết nối ${connectedCount} thiết bị, ${runningCount} thiết bị đang chạy kịch bản`;
    }
}

/**
 * Update application status by fetching script status
 */
async function updateStatus() {
    try {
        // Get running script status
        const runningStatus = await window.pywebview.api.get_script_status();

        // Update devices with running status
        for (const [serial, status] of Object.entries(runningStatus)) {
            const deviceIndex = state.devices.findIndex(d => d.serial === serial);
            if (deviceIndex >= 0) {
                state.devices[deviceIndex].running = status.running;
            }
        }

        // Update UI to reflect current status
        updateStatusBar();
        updateDeviceSelectionList();
        updateStartScriptButton();
    } catch (error) {
        console.error('Error updating status:', error);
    }
}

/**
 * Refresh the list of connected devices
 */
async function refreshDevicesList() {
    const devicesList = document.getElementById('devices-list');
    devicesList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Đang tải danh sách thiết bị...</div>';

    try {
        const devices = await window.pywebview.api.get_devices();
        state.devices = devices;

        // Update device selection in scripts tab
        updateDeviceSelectionList();

        // Update status bar
        updateStatusBar();

        if (devices.length === 0) {
            devicesList.innerHTML = '<div class="placeholder">Không có thiết bị nào được kết nối</div>';
            return;
        }

        // Render devices list with grid layout
        devicesList.innerHTML = '<div class="devices-grid"></div>';
        const devicesGrid = devicesList.querySelector('.devices-grid');

        devices.forEach(device => {
            const deviceCard = createDeviceCard(device);
            devicesGrid.appendChild(deviceCard);
        });

        showToast('Đã cập nhật danh sách thiết bị', 'success');
    } catch (error) {
        console.error('Error refreshing devices:', error);
        devicesList.innerHTML = `<div class="error">Lỗi khi tải danh sách thiết bị: ${error.message || error}</div>`;
        showToast('Lỗi khi tải danh sách thiết bị', 'error');
    }
}

/**
 * Stop script execution on selected devices
 */
async function stopScript() {
    const runningDevices = state.selectedDevicesForScript.filter(serial => {
        const device = state.devices.find(d => d.serial === serial);
        return device && device.running;
    });

    if (runningDevices.length === 0) {
        showToast('Không có kịch bản nào đang chạy để dừng lại', 'warning');
        return;
    }

    try {
        showToast('Đang dừng kịch bản...', 'info');

        const result = await window.pywebview.api.stop_script(runningDevices);

        if (result.error) {
            showToast(`Lỗi khi dừng kịch bản: ${result.error}`, 'error');
            return;
        }

        showToast(`Đã dừng kịch bản trên ${result.stopped.length} thiết bị`, 'success');

        // Refresh devices to update running status
        await refreshDevicesList();

        // Update start/stop buttons
        updateStartScriptButton();

        // Refresh logs for the current device
        refreshCurrentDeviceLogs();
    } catch (error) {
        console.error('Error stopping script:', error);
        showToast(`Lỗi khi dừng kịch bản: ${error.message || error}`, 'error');
    }
}

/**
 * Start script execution on selected devices
 */
async function startScript() {
    if (!state.selectedScript || state.selectedDevicesForScript.length === 0) {
        showToast('Vui lòng chọn kịch bản và ít nhất một thiết bị', 'warning');
        return;
    }

    // Get script configuration
    const config = collectScriptConfig();

    // Display starting notification
    showToast(`Đang khởi chạy kịch bản trên ${state.selectedDevicesForScript.length} thiết bị...`, 'info');

    try {
        // Save configuration before running
        saveScriptConfig();

        const result = await window.pywebview.api.run_script(state.selectedScript.name, state.selectedDevicesForScript, config);

        if (result.error) {
            showToast(`Lỗi khi khởi chạy kịch bản: ${result.error}`, 'error');
            return;
        }

        showToast(result.message || 'Kịch bản đã bắt đầu chạy', 'success');

        // Refresh devices to update running status
        await refreshDevicesList();

        // Update start/stop buttons
        updateStartScriptButton();

        // Configure log viewer for the first running device
        setupLogViewerForRunningDevice();
    } catch (error) {
        console.error('Error starting script:', error);
        showToast(`Lỗi khi khởi chạy kịch bản: ${error.message || error}`, 'error');
    }
}

/**
 * Deselect all devices in the device selection list
 */
function deselectAllDevices() {
    const checkboxes = document.querySelectorAll('#device-selection-list .device-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    updateSelectedDevicesForScript();
}

/**
 * Select all devices in the device selection list
 */
function selectAllDevices() {
    const checkboxes = document.querySelectorAll('#device-selection-list .device-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    updateSelectedDevicesForScript();
}

/**
 * Handler for log device selector changes
 */
function handleLogDeviceChange(e) {
    const deviceSerial = e.target.value;
    if (deviceSerial) {
        refreshScriptLogs(deviceSerial);
        // Start polling for logs
        if (state.logPollingIntervals[deviceSerial]) {
            clearInterval(state.logPollingIntervals[deviceSerial]);
        }
        state.logPollingIntervals[deviceSerial] = setInterval(() => {
            refreshScriptLogs(deviceSerial);
        }, 2000);
    }
}

/**
 * Initialize scripts tab functionality
 */
function initScriptsTab() {
    // Refresh scripts button
    document.getElementById('refresh-scripts').addEventListener('click', refreshScriptsList);

    // Device selection buttons
    document.getElementById('select-all-devices').addEventListener('click', selectAllDevices);
    document.getElementById('deselect-all-devices').addEventListener('click', deselectAllDevices);

    // Script control buttons
    document.getElementById('start-script').addEventListener('click', startScript);
    document.getElementById('stop-script').addEventListener('click', stopScript);
    document.getElementById('save-config').addEventListener('click', saveScriptConfig);
    document.getElementById('reset-config').addEventListener('click', resetScriptConfig);

    // Log device selector
    document.getElementById('log-device-selector').addEventListener('change', handleLogDeviceChange);

    // Clear logs button
    document.getElementById('clear-logs').addEventListener('click', () => {
        const deviceSelector = document.getElementById('log-device-selector');
        const deviceSerial = deviceSelector.value;
        if (deviceSerial) {
            clearScriptLogs(deviceSerial);
        }
    });
}

/**
 * Initialize devices tab functionality
 */
function initDevicesTab() {
    // Refresh devices button
    document.getElementById('refresh-devices').addEventListener('click', refreshDevicesList);

    // Back to devices list button
    document.getElementById('back-to-devices').addEventListener('click', () => {
        document.getElementById('devices-list').classList.remove('hidden');
        document.getElementById('device-details').classList.add('hidden');
        state.selectedDevice = null;
    });

    // Device action buttons
    const actionButtons = document.querySelectorAll('.device-actions button[data-action]');
    actionButtons.forEach(button => {
        button.addEventListener('click', () => {
            const action = button.getAttribute('data-action');
            executeDeviceAction(action);
        });
    });

    // XPath buttons
    document.getElementById('check-xpath').addEventListener('click', () => {
        const xpath = document.getElementById('xpath-input').value.trim();
        if (xpath) {
            executeDeviceAction('check_xpath', { xpath });
        } else {
            showToast('Vui lòng nhập biểu thức XPath', 'warning');
        }
    });

    document.getElementById('click-xpath').addEventListener('click', () => {
        const xpath = document.getElementById('xpath-input').value.trim();
        if (xpath) {
            executeDeviceAction('click_xpath', { xpath });
        } else {
            showToast('Vui lòng nhập biểu thức XPath', 'warning');
        }
    });
}

/**
 * Initialize tab functionality
 */
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to clicked button
            button.classList.add('active');

            // Show corresponding content
            const tabId = button.id.replace('tab-', '');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });
}

/**
 * Initialize the main application
 */
function initApplication() {
    console.log('Initializing PyPhone application...');

    // Initialize tabs
    initTabs();

    // Initialize devices tab
    initDevicesTab();

    // Initialize scripts tab
    initScriptsTab();

    // Refresh devices list on startup
    refreshDevicesList();

    // Refresh scripts list on startup
    refreshScriptsList();

    // Start periodic status updates
    setInterval(updateStatus, 5000);

    console.log('PyPhone application initialized');
}