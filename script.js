const forecastList = document.getElementById('forecast-list');
const loading = document.getElementById('loading');
const locationNameEl = document.getElementById('location-name');
const umbrellaSummary = document.getElementById('umbrella-summary');
const umbrellaSummaryIcon = document.getElementById('umbrella-summary-icon');
const umbrellaSummaryLabel = document.getElementById('umbrella-summary-label');
const umbrellaVerdict = document.getElementById('umbrella-verdict');
const umbrellaReason = document.getElementById('umbrella-reason');
const umbrellaWindow = document.getElementById('umbrella-window');
const forecastUpdatedAt = document.getElementById('forecast-updated-at');

const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnGetGps = document.getElementById('btn-get-gps');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnRefresh = document.getElementById('btn-refresh');

const inputLat = document.getElementById('input-lat');
const inputLon = document.getElementById('input-lon');
const inputSearch = document.getElementById('input-search');
const inputTestMode = document.getElementById('input-test-mode');
const btnSearch = document.getElementById('btn-search');
const searchResults = document.getElementById('search-results');

// デフォルトは東京
let currentLat = 35.6895;
let currentLon = 139.6917;
let testMode = false;
let lastTestScenarioIndex = -1;
let weatherRequestId = 0;
let locationRequestId = 0;
let lastFocusedElement = null;

const TEST_WEATHER_SCENARIOS = [
    { label: '晴れ', minProb: 0, maxProb: 20, minAmount: 0, maxAmount: 0 },
    { label: '降水確率のみ高め', minProb: 30, maxProb: 70, minAmount: 0, maxAmount: 0 },
    { label: '弱い雨', minProb: 40, maxProb: 90, minAmount: 0.1, maxAmount: 0.9 },
    { label: '通常の雨', minProb: 50, maxProb: 100, minAmount: 1, maxAmount: 9.9 },
    { label: 'やや強い雨', minProb: 60, maxProb: 100, minAmount: 10, maxAmount: 19.9 },
    { label: '強い雨', minProb: 70, maxProb: 100, minAmount: 20, maxAmount: 29.9 },
    { label: '激しい雨', minProb: 80, maxProb: 100, minAmount: 30, maxAmount: 49.9 },
    { label: '非常に激しい雨', minProb: 90, maxProb: 100, minAmount: 50, maxAmount: 80 }
];

function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.warn('Storage read failed:', error);
        return null;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.warn('Storage write failed:', error);
    }
}

function storageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.warn('Storage removal failed:', error);
    }
}

function isValidCoordinates(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= -90 && lat <= 90
        && lon >= -180 && lon <= 180;
}

function getWeatherCacheKeys(lat, lon) {
    const cacheKey = `appare_weather_${lat.toFixed(4)}_${lon.toFixed(4)}`;
    return { cacheKey, cacheTimeKey: `${cacheKey}_time` };
}

function normalizeProbability(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, Math.round(number)));
}

function normalizeAmount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, number);
}

function isValidHourlyData(hourly) {
    if (!hourly || typeof hourly !== 'object') return false;
    const { time, precipitation_probability: probabilities, precipitation } = hourly;
    if (!Array.isArray(time) || !Array.isArray(probabilities) || !Array.isArray(precipitation)) return false;
    if (time.length === 0 || time.length !== probabilities.length || time.length !== precipitation.length) return false;
    return time.every(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value));
}

function readCachedWeather(cacheKey, cacheTimeKey) {
    const cachedData = storageGet(cacheKey);
    const cachedTime = Number.parseInt(storageGet(cacheTimeKey), 10);
    if (!cachedData) return null;

    try {
        const parsed = JSON.parse(cachedData);
        if (!isValidHourlyData(parsed.hourly)) throw new Error('Invalid cached weather data');
        return {
            hourly: parsed.hourly,
            updatedAt: Number.isFinite(cachedTime) ? cachedTime : Date.now()
        };
    } catch (error) {
        storageRemove(cacheKey);
        storageRemove(cacheTimeKey);
        return null;
    }
}

function createStatusElement(message, className) {
    const status = document.createElement('div');
    status.className = className;
    status.setAttribute('role', 'status');
    status.textContent = message;
    return status;
}

function setSearchStatus(message, isError = false) {
    const className = isError ? 'search-status error' : 'search-status';
    searchResults.replaceChildren(createStatusElement(message, className));
}

function showForecastMessage(message, isError = false) {
    const className = isError ? 'status-message error' : 'status-message';
    forecastList.replaceChildren(createStatusElement(message, className));
}

async function fetchJson(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
            referrerPolicy: 'strict-origin-when-cross-origin'
        });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

function shiftForecastTime(timeStr, hours) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(timeStr);
    if (!match) return null;

    const [, year, month, day, hour, minute] = match;
    const shifted = new Date(Date.UTC(
        Number(year), Number(month) - 1, Number(day), Number(hour) + hours, Number(minute)
    ));
    const shiftedYear = shifted.getUTCFullYear();
    const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
    const shiftedHour = String(shifted.getUTCHours()).padStart(2, '0');
    const shiftedMinute = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${shiftedYear}-${shiftedMonth}-${shiftedDay}T${shiftedHour}:${shiftedMinute}`;
}

// PWA Service Worker 登録とアップデート検知
let newWorker;
const updateBanner = document.getElementById('update-banner');
const btnUpdateYes = document.getElementById('btn-update-yes');
const btnUpdateNo = document.getElementById('btn-update-no');

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(registration => {
            console.log('SW registered: ', registration);
            
            registration.addEventListener('updatefound', () => {
                newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        updateBanner.classList.remove('hidden');
                    }
                });
            });
            
            if (registration.waiting) {
                newWorker = registration.waiting;
                updateBanner.classList.remove('hidden');
            }
        }).catch(registrationError => {
            console.log('SW registration failed: ', registrationError);
        });
        
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    });
}

if (btnUpdateYes) {
    btnUpdateYes.addEventListener('click', () => {
        if (newWorker) {
            newWorker.postMessage({ action: 'skipWaiting' });
        }
        updateBanner.classList.add('hidden');
    });
}

if (btnUpdateNo) {
    btnUpdateNo.addEventListener('click', () => {
        updateBanner.classList.add('hidden');
    });
}

function init() {
    loadSettings();
    setupEventListeners();
    fetchWeather();
}

function loadSettings() {
    const savedLat = Number.parseFloat(storageGet('appare_lat'));
    const savedLon = Number.parseFloat(storageGet('appare_lon'));
    const savedTestMode = storageGet('appare_test_mode');
    const defaultOffApplied = storageGet('appare_test_mode_default_off_v1') === 'true';
    
    if (isValidCoordinates(savedLat, savedLon)) {
        currentLat = savedLat;
        currentLon = savedLon;
    }
    
    inputLat.value = currentLat;
    inputLon.value = currentLon;
    // テスト後の通常運用へ戻すため、この版では一度だけ確実にOFFへ移行する。
    // 以後は設定画面で選んだON/OFFをそのまま保存する。
    if (!defaultOffApplied) {
        testMode = false;
        storageSet('appare_test_mode', 'false');
        storageSet('appare_test_mode_default_off_v1', 'true');
    } else {
        testMode = savedTestMode === 'true';
    }
    inputTestMode.checked = testMode;
}

function saveSettings() {
    const lat = parseFloat(inputLat.value);
    const lon = parseFloat(inputLon.value);
    
    // 入力値のバリデーション（空欄や不正な文字列を防ぐ）
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        alert("正しい緯度（-90〜90の数値）を入力してください。");
        return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
        alert("正しい経度（-180〜180の数値）を入力してください。");
        return;
    }

    currentLat = lat;
    currentLon = lon;
    storageSet('appare_lat', currentLat.toString());
    storageSet('appare_lon', currentLon.toString());
    
    settingsModal.classList.add('hidden');
    fetchWeather();
}

function setupEventListeners() {
    btnSettings.addEventListener('click', () => {
        lastFocusedElement = document.activeElement;
        settingsModal.classList.remove('hidden');
        inputSearch.focus();
    });

    btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
    });

    settingsModal.addEventListener('click', event => {
        if (event.target === settingsModal) {
            settingsModal.classList.add('hidden');
            if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            settingsModal.classList.add('hidden');
            if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
        }
    });

    btnSaveSettings.addEventListener('click', saveSettings);

    inputTestMode.addEventListener('change', () => {
        testMode = inputTestMode.checked;
        storageSet('appare_test_mode', testMode.toString());
        fetchWeather();
    });

    const searchForm = document.getElementById('search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            searchLocation();
            inputSearch.blur(); // スマホのキーボードを閉じる
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            const { cacheKey, cacheTimeKey } = getWeatherCacheKeys(currentLat, currentLon);
            storageRemove(cacheKey);
            storageRemove(cacheTimeKey);
            fetchWeather();
        });
    }

    btnGetGps.addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert('お使いのブラウザは位置情報に対応していません。');
            return;
        }
        
        btnGetGps.textContent = '取得中...';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                inputLat.value = position.coords.latitude.toFixed(4);
                inputLon.value = position.coords.longitude.toFixed(4);
                btnGetGps.textContent = '📍 現在地を取得';
                saveSettings(); // 自動的に保存して更新
            },
            () => {
                alert('位置情報を取得できませんでした。権限を確認してください。');
                btnGetGps.textContent = '📍 現在地を取得';
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    });
}

async function searchLocation() {
    const query = inputSearch.value.trim();
    if (!query) return;

    btnSearch.textContent = '検索中...';
    btnSearch.disabled = true;
    setSearchStatus('検索中...');

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=ja`;
        const data = await fetchJson(url);
        if (!Array.isArray(data)) throw new Error('Invalid search response');
        
        searchResults.replaceChildren();
        if (data.length === 0) {
            setSearchStatus('見つかりませんでした');
        } else {
            data.slice(0, 5).forEach(item => {
                const lat = Number.parseFloat(item.lat);
                const lon = Number.parseFloat(item.lon);
                if (!isValidCoordinates(lat, lon) || typeof item.display_name !== 'string') return;

                const resultButton = document.createElement('button');
                resultButton.type = 'button';
                resultButton.className = 'search-result-item';
                
                const nameParts = item.display_name.split(', ');
                const mainName = nameParts[0];
                const descName = nameParts.slice(1).join(', ');

                const nameElement = document.createElement('div');
                nameElement.className = 'item-name';
                nameElement.textContent = mainName;

                const descriptionElement = document.createElement('div');
                descriptionElement.className = 'item-desc';
                descriptionElement.textContent = descName;

                resultButton.append(nameElement, descriptionElement);
                
                resultButton.addEventListener('click', () => {
                    inputLat.value = lat.toFixed(4);
                    inputLon.value = lon.toFixed(4);
                    inputSearch.value = '';
                    searchResults.replaceChildren();
                    saveSettings(); // 自動的に保存して更新
                });
                
                searchResults.appendChild(resultButton);
            });
            if (!searchResults.hasChildNodes()) setSearchStatus('有効な検索結果がありませんでした');
        }
    } catch (error) {
        console.error('Location search failed:', error);
        setSearchStatus('検索に失敗しました。しばらくしてから再試行してください。', true);
    } finally {
        btnSearch.textContent = '🔍 検索';
        btnSearch.disabled = false;
    }
}

async function fetchLocationName(lat, lon) {
    const requestId = ++locationRequestId;
    // 1. キャッシュの確認 (APIの利用規約制限を避けるため)
    const cacheKey = `appare_loc_${lat.toFixed(4)}_${lon.toFixed(4)}`;
    const cachedName = storageGet(cacheKey);
    if (cachedName) {
        if (requestId === locationRequestId) locationNameEl.textContent = `📍 ${cachedName}`;
        return;
    }
    
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=ja`;
        const data = await fetchJson(url);
        if (requestId !== locationRequestId) return;
        if (data && data.address) {
            const ad = data.address;
            const name = ad.city || ad.town || ad.village || ad.county || ad.state || ad.country || "不明な地域";
            locationNameEl.textContent = `📍 ${name}`;
            storageSet(cacheKey, String(name).slice(0, 120)); // キャッシュに保存
        } else {
            locationNameEl.textContent = `📍 緯度:${lat.toFixed(2)} 経度:${lon.toFixed(2)}`;
        }
    } catch (e) {
        if (requestId === locationRequestId) {
            locationNameEl.textContent = `📍 緯度:${lat.toFixed(2)} 経度:${lon.toFixed(2)}`;
        }
    }
}

async function fetchWeather() {
    const requestId = ++weatherRequestId;
    const requestLat = currentLat;
    const requestLon = currentLon;
    loading.classList.remove('hidden');
    umbrellaSummary.classList.add('hidden');
    forecastList.replaceChildren();
    btnRefresh.disabled = true;
    btnRefresh.setAttribute('aria-busy', 'true');
    
    // 地名を取得して表示
    try {
        fetchLocationName(requestLat, requestLon);

        if (testMode) {
            const testWeather = generateTestWeather();
            if (requestId !== weatherRequestId) return;
            processWeatherData(testWeather.hourly, {
                updatedAt: Date.now(),
                isStale: false,
                isTest: true,
                testLabel: testWeather.label
            });
            return;
        }

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${requestLat}&longitude=${requestLon}&hourly=precipitation_probability,precipitation&timezone=auto&forecast_hours=36`;
        const { cacheKey, cacheTimeKey } = getWeatherCacheKeys(requestLat, requestLon);
        const cachedWeather = readCachedWeather(cacheKey, cacheTimeKey);
        const now = Date.now();

        if (cachedWeather && (now - cachedWeather.updatedAt) < 15 * 60 * 1000) {
            if (requestId !== weatherRequestId) return;
            processWeatherData(cachedWeather.hourly, {
                updatedAt: cachedWeather.updatedAt,
                isStale: false
            });
            return;
        }

        try {
            const data = await fetchJson(url, 15000);
            if (!isValidHourlyData(data.hourly)) throw new Error('Invalid weather response');
            if (requestId !== weatherRequestId) return;

            storageSet(cacheKey, JSON.stringify({ hourly: data.hourly }));
            storageSet(cacheTimeKey, now.toString());

            processWeatherData(data.hourly, {
                updatedAt: now,
                isStale: false
            });
        } catch (error) {
            if (requestId !== weatherRequestId) return;
            console.error('Weather fetch failed:', error);
            if (cachedWeather) {
                processWeatherData(cachedWeather.hourly, {
                    updatedAt: cachedWeather.updatedAt,
                    isStale: true
                });
            } else {
                showForecastMessage('データの取得に失敗しました。通信状態を確認して更新してください。', true);
            }
        }
    } finally {
        if (requestId === weatherRequestId) {
            loading.classList.add('hidden');
            btnRefresh.disabled = false;
            btnRefresh.removeAttribute('aria-busy');
        }
    }
}

function processWeatherData(hourly, metadata) {
    if (!isValidHourlyData(hourly)) {
        umbrellaSummary.classList.add('hidden');
        showForecastMessage('予報データの形式が正しくありません。', true);
        return;
    }

    renderUmbrellaSummary(hourly, metadata);

    const slots = buildTwoHourSlots(hourly);

    forecastList.replaceChildren();
    const fragment = document.createDocumentFragment();

    slots.forEach(slot => renderItem(slot, fragment));
    forecastList.appendChild(fragment);
}

function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDecimal(min, max) {
    if (min === max) return min;
    return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function formatTestForecastTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:00`;
}

function generateTestWeather() {
    let scenarioIndex;
    do {
        scenarioIndex = randomInteger(0, TEST_WEATHER_SCENARIOS.length - 1);
    } while (scenarioIndex === lastTestScenarioIndex && TEST_WEATHER_SCENARIOS.length > 1);
    lastTestScenarioIndex = scenarioIndex;

    const scenario = TEST_WEATHER_SCENARIOS[scenarioIndex];
    const start = new Date();
    start.setMinutes(0, 0, 0);

    const time = [];
    const precipitationProbability = [];
    const precipitation = [];

    for (let i = 0; i < 36; i++) {
        const forecastDate = new Date(start.getTime() + i * 60 * 60 * 1000);
        time.push(formatTestForecastTime(forecastDate));
        precipitationProbability.push(randomInteger(0, 20));
        precipitation.push(0);
    }

    const daytimeCandidates = time
        .map((timeStr, index) => {
            const intervalStart = shiftForecastTime(timeStr, -1);
            return intervalStart ? {
                index,
                date: intervalStart.substring(0, 10),
                hour: parseInt(intervalStart.substring(11, 13), 10)
            } : null;
        })
        .filter(Boolean)
        .filter(entry => entry.hour >= 7 && entry.hour <= 17);
    const targetDate = daytimeCandidates[0]?.date;
    const targetIndexes = daytimeCandidates
        .filter(entry => entry.date === targetDate)
        .map(entry => entry.index);

    if (targetIndexes.length > 0) {
        if (scenarioIndex === 0) {
            targetIndexes.forEach(index => {
                precipitationProbability[index] = randomInteger(scenario.minProb, scenario.maxProb);
            });
        } else {
            const duration = Math.min(randomInteger(1, 3), targetIndexes.length);
            const startOffset = randomInteger(0, targetIndexes.length - duration);
            targetIndexes.slice(startOffset, startOffset + duration).forEach(index => {
                precipitationProbability[index] = randomInteger(scenario.minProb, scenario.maxProb);
                precipitation[index] = randomDecimal(scenario.minAmount, scenario.maxAmount);
            });
        }
    }

    return {
        label: scenario.label,
        hourly: {
            time,
            precipitation_probability: precipitationProbability,
            precipitation
        }
    };
}

function buildTwoHourSlots(hourly) {
    const times = hourly.time;
    const probs = hourly.precipitation_probability;
    const precip = hourly.precipitation;

    const slotsByStartTime = new Map();
    const sourceLength = Math.min(36, times.length);

    // Open-Meteoの時刻は「その時刻までの直前1時間」の合計値。
    // 例: 08:00の値は07:00〜08:00なので、07:00を含む2時間枠へ集約する。
    for (let i = 0; i < sourceLength; i++) {
        const intervalStart = shiftForecastTime(times[i], -1);
        if (!intervalStart) continue;

        const startHour = parseInt(intervalStart.substring(11, 13), 10);
        const slotStartHour = Math.floor(startHour / 2) * 2;
        const slotStart = `${intervalStart.substring(0, 11)}${String(slotStartHour).padStart(2, '0')}:00`;

        if (!slotsByStartTime.has(slotStart)) {
            slotsByStartTime.set(slotStart, {
                timeStr: slotStart,
                probability: 0,
                amount: 0
            });
        }

        const slot = slotsByStartTime.get(slotStart);
        slot.probability = Math.max(slot.probability, normalizeProbability(probs[i]));
        slot.amount = Math.max(slot.amount, normalizeAmount(precip[i]));
    }

    return Array.from(slotsByStartTime.values());
}

function getDaytimeUmbrellaAnalysis(hourly) {
    const entries = hourly.time.map((timeStr, index) => {
        const intervalStart = shiftForecastTime(timeStr, -1);
        if (!intervalStart) return null;
        const hour = parseInt(intervalStart.substring(11, 13), 10);
        return {
            timeStr: intervalStart,
            date: intervalStart.substring(0, 10),
            hour,
            probability: normalizeProbability(hourly.precipitation_probability[index]),
            amount: normalizeAmount(hourly.precipitation[index])
        };
    }).filter(Boolean);

    if (entries.length === 0) return null;

    // 現在以降で最初にデータが揃う7:00〜17:59を判定対象にする。
    // 17時を過ぎていれば、自動的に翌日の時間帯が選ばれる。
    const firstDaytimeEntry = entries.find(entry => entry.hour >= 7 && entry.hour <= 17);
    if (!firstDaytimeEntry) return null;

    const targetDate = firstDaytimeEntry.date;
    const daytimeEntries = entries.filter(entry =>
        entry.date === targetDate && entry.hour >= 7 && entry.hour <= 17
    );
    const maxProbability = Math.max(...daytimeEntries.map(entry => entry.probability));
    const maxAmount = Math.max(...daytimeEntries.map(entry => entry.amount));
    const riskEntries = daytimeEntries.filter(entry => entry.probability >= 30 || entry.amount >= 0.1);
    const baseDate = entries[0].date;
    const dayDiff = Math.round(
        (Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${baseDate}T00:00:00Z`)) / 86400000
    );
    const [, monthStr, dayStr] = targetDate.split('-');
    const dayLabel = dayDiff === 0
        ? '今日'
        : dayDiff === 1
            ? '明日'
            : `${parseInt(monthStr, 10)}/${parseInt(dayStr, 10)}`;

    let level = 'none';
    let kappaSrc = maxProbability === 0 && maxAmount === 0
        ? 'icon_dried.png'
        : 'icon_normal.png';
    let kappaClass = maxProbability === 0 && maxAmount === 0
        ? 'row-kappa-dried'
        : 'row-kappa-normal';
    let verdict = '傘は必要なさそう';

    if (maxAmount >= 50) {
        level = 'severe';
        kappaSrc = 'icon_dancing.png';
        kappaClass = 'row-kappa-breakdance';
        verdict = '傘が役に立たない雨';
    } else if (maxAmount >= 20) {
        level = 'severe';
        kappaSrc = 'icon_dancing.png';
        kappaClass = 'row-kappa-breakdance';
        verdict = '傘でもぬれる強い雨';
    } else if (maxAmount >= 10) {
        level = 'long';
        kappaSrc = 'icon_dancing.png';
        kappaClass = 'row-kappa-dance';
        verdict = '大きめの長傘がおすすめ';
    } else if (maxAmount >= 1) {
        level = 'long';
        kappaSrc = 'icon_dancing.png';
        kappaClass = 'row-kappa-dance';
        verdict = '長傘がおすすめ';
    } else if (maxProbability >= 30 || maxAmount >= 0.1) {
        level = 'folding';
        kappaSrc = 'icon_normal.png';
        kappaClass = 'row-kappa-normal';
        verdict = '折りたたみ傘があると安心';
    }

    const reason = `最高降水確率 ${maxProbability}%・最大 ${maxAmount.toFixed(1)} mm/hです。`;
    let riskWindow = '雨の可能性が高い時間はありません';
    if (riskEntries.length > 0) {
        const riskGroups = [];
        riskEntries.forEach(entry => {
            const lastGroup = riskGroups[riskGroups.length - 1];
            if (!lastGroup || entry.hour > lastGroup.end) {
                riskGroups.push({ start: entry.hour, end: entry.hour + 1 });
            } else {
                lastGroup.end = entry.hour + 1;
            }
        });
        const formattedGroups = riskGroups
            .map(group => `${group.start}〜${group.end}時`)
            .join('・');
        riskWindow = `注意時間 ${formattedGroups}`;
    }

    return {
        dayLabel,
        level,
        kappaSrc,
        kappaClass,
        verdict,
        reason,
        riskWindow
    };
}

function renderUmbrellaSummary(hourly, metadata) {
    const analysis = getDaytimeUmbrellaAnalysis(hourly);
    if (!analysis) {
        umbrellaSummary.classList.add('hidden');
        return;
    }

    umbrellaSummary.dataset.level = analysis.level;
    umbrellaSummaryIcon.src = analysis.kappaSrc;
    umbrellaSummaryIcon.className = `umbrella-summary-icon ${analysis.kappaClass}`;
    umbrellaSummaryLabel.textContent = `${analysis.dayLabel} 7〜17時の傘`;
    umbrellaVerdict.textContent = analysis.verdict;
    umbrellaReason.textContent = analysis.reason;
    umbrellaWindow.textContent = analysis.riskWindow;

    const safeUpdatedAt = Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : Date.now();
    const updatedDate = new Date(safeUpdatedAt);
    const formattedUpdatedAt = new Intl.DateTimeFormat('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(updatedDate);
    forecastUpdatedAt.textContent = metadata.isStale
        ? `保存済み予報・${formattedUpdatedAt}更新`
        : metadata.isTest
            ? `テスト：${metadata.testLabel}・${formattedUpdatedAt}更新`
            : `${formattedUpdatedAt}更新`;
    forecastUpdatedAt.classList.toggle('stale', metadata.isStale);
    forecastUpdatedAt.classList.toggle('test', metadata.isTest);
    umbrellaSummary.classList.remove('hidden');
}

function renderItem(slot, fragment) {
    const timeStr = slot.timeStr;
    const prob = normalizeProbability(slot.probability);
    const amount = normalizeAmount(slot.amount);

    // 時間のフォーマット (例: 7/5 14:00)
    const datePart = timeStr.split('T')[0];
    const [, monthStr, dayStr] = datePart.split('-');
    const hourStr = timeStr.substring(11, 13);
    
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const hourNum = parseInt(hourStr, 10);
    
    const endHour = (hourNum + 2) % 24;
    const dateDisplay = `${month}/${day}`;
    const timeDisplay = `${hourStr}〜${String(endHour).padStart(2, '0')}時`;
    
    // 特定の時間帯を強調 (6, 8, 10, 12, 14, 16時)
    const isHighlightHour = [6, 8, 10, 12, 14, 16].includes(hourNum);
    
    // 行ごとのカッパアイコン判定
    let rowKappaSrc = 'icon_normal.png';
    let rowKappaClass = 'row-kappa-normal';
    let needsPuddle = false;
    
    if (amount >= 50) {
        rowKappaSrc = 'icon_dancing.png';
        rowKappaClass = 'row-kappa-runaway';
        needsPuddle = true;
    } else if (prob === 100 && amount >= 0.6) {
        rowKappaSrc = 'icon_dancing.png';
        rowKappaClass = 'row-kappa-breakdance';
    } else if (prob > 40 && amount >= 0.6) {
        rowKappaSrc = 'icon_dancing.png';
        rowKappaClass = 'row-kappa-dance';
    } else if (prob > 0) {
        rowKappaSrc = 'icon_normal.png';
        rowKappaClass = 'row-kappa-normal';
    } else if (prob === 0) {
        rowKappaSrc = 'icon_dried.png';
        rowKappaClass = 'row-kappa-dried';
    }
    
    const isMidnight = (hourNum === 0);
    
    const div = document.createElement('div');
    let classes = `forecast-item`;
    if (prob > 50) {
        classes += ' rain heavy-rain';
    } else if (prob >= 30) {
        classes += ' rain';
    }
    if (isHighlightHour) classes += ' highlight-time';
    if (isMidnight) classes += ' midnight-boundary'; // 0:00を強調
    if (hourNum === 6) classes += ' daytime-start'; // 6〜8時を必ず行の左端にする
    div.className = classes;

    const timeContainer = document.createElement('div');
    timeContainer.className = 'time-container';

    const dateElement = document.createElement('div');
    dateElement.className = 'date';
    dateElement.textContent = dateDisplay;

    const timeElement = document.createElement('div');
    timeElement.className = 'time';
    timeElement.textContent = timeDisplay;

    timeContainer.append(dateElement, timeElement);

    if (needsPuddle) {
        const puddle = document.createElement('div');
        puddle.className = 'puddle';
        timeContainer.appendChild(puddle);
    }

    const kappaImage = document.createElement('img');
    kappaImage.src = rowKappaSrc;
    kappaImage.className = `row-kappa ${rowKappaClass}`;
    kappaImage.alt = '';
    timeContainer.appendChild(kappaImage);

    const primaryInfo = document.createElement('div');
    primaryInfo.className = 'primary-info';

    const probabilityLabel = document.createElement('div');
    probabilityLabel.className = 'info-label';
    probabilityLabel.textContent = '降水確率';

    const probabilityValue = document.createElement('div');
    probabilityValue.className = 'prob';
    probabilityValue.textContent = String(prob);
    const percentUnit = document.createElement('small');
    percentUnit.textContent = '%';
    probabilityValue.appendChild(percentUnit);

    const amountLabel = document.createElement('div');
    amountLabel.className = 'info-label';
    amountLabel.textContent = '最大雨量';

    const amountValue = document.createElement('div');
    amountValue.className = 'amount';
    amountValue.textContent = `${amount.toFixed(1)} mm`;

    primaryInfo.append(probabilityLabel, probabilityValue, amountLabel, amountValue);
    div.append(timeContainer, primaryInfo);
    
    fragment.appendChild(div);
}

// 起動
init();
