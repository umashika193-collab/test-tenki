const forecastList = document.getElementById('forecast-list');
const loading = document.getElementById('loading');
const locationNameEl = document.getElementById('location-name');

const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnGetGps = document.getElementById('btn-get-gps');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnRefresh = document.getElementById('btn-refresh');

const inputLat = document.getElementById('input-lat');
const inputLon = document.getElementById('input-lon');
const inputSearch = document.getElementById('input-search');
const btnSearch = document.getElementById('btn-search');
const searchResults = document.getElementById('search-results');

// デフォルトは東京
let currentLat = 35.6895;
let currentLon = 139.6917;

// PWA Service Worker 登録
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(registration => {
            console.log('SW registered: ', registration);
        }).catch(registrationError => {
            console.log('SW registration failed: ', registrationError);
        });
    });
}

function init() {
    loadSettings();
    setupEventListeners();
    fetchWeather();
}

function loadSettings() {
    const savedLat = localStorage.getItem('appare_lat');
    const savedLon = localStorage.getItem('appare_lon');
    
    if (savedLat && savedLon) {
        currentLat = parseFloat(savedLat);
        currentLon = parseFloat(savedLon);
    }
    
    inputLat.value = currentLat;
    inputLon.value = currentLon;
}

function saveSettings() {
    const lat = parseFloat(inputLat.value);
    const lon = parseFloat(inputLon.value);
    
    // 入力値のバリデーション（空欄や不正な文字列を防ぐ）
    if (isNaN(lat) || lat < -90 || lat > 90) {
        alert("正しい緯度（-90〜90の数値）を入力してください。");
        return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
        alert("正しい経度（-180〜180の数値）を入力してください。");
        return;
    }

    currentLat = lat;
    currentLon = lon;
    localStorage.setItem('appare_lat', currentLat);
    localStorage.setItem('appare_lon', currentLon);
    
    settingsModal.classList.add('hidden');
    fetchWeather();
}

function setupEventListeners() {
    btnSettings.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    btnSaveSettings.addEventListener('click', saveSettings);

    if (btnSearch) {
        btnSearch.addEventListener('click', searchLocation);
        inputSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchLocation();
            }
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            const cacheKey = `appare_weather_${currentLat.toFixed(2)}_${currentLon.toFixed(2)}`;
            const cacheTimeKey = `${cacheKey}_time`;
            localStorage.removeItem(cacheKey);
            localStorage.removeItem(cacheTimeKey);
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
            (error) => {
                alert('位置情報を取得できませんでした。権限を確認してください。');
                btnGetGps.textContent = '📍 現在地を取得';
            }
        );
    });
}

async function searchLocation() {
    const query = inputSearch.value.trim();
    if (!query) return;

    btnSearch.textContent = '検索中...';
    btnSearch.disabled = true;
    searchResults.innerHTML = '<div style="padding: 1rem; text-align: center;">検索中...</div>';

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=ja`;
        const res = await fetch(url);
        const data = await res.json();
        
        searchResults.innerHTML = '';
        if (data.length === 0) {
            searchResults.innerHTML = '<div style="padding: 1rem; text-align: center; color: #aaa;">見つかりませんでした</div>';
        } else {
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                
                const nameParts = item.display_name.split(', ');
                const mainName = nameParts[0];
                const descName = nameParts.slice(1).join(', ');

                div.innerHTML = `
                    <div class="item-name">${mainName}</div>
                    <div class="item-desc">${descName}</div>
                `;
                
                div.addEventListener('click', () => {
                    inputLat.value = parseFloat(item.lat).toFixed(4);
                    inputLon.value = parseFloat(item.lon).toFixed(4);
                    inputSearch.value = '';
                    searchResults.innerHTML = '';
                    saveSettings(); // 自動的に保存して更新
                });
                
                searchResults.appendChild(div);
            });
        }
    } catch (error) {
        searchResults.innerHTML = '<div style="padding: 1rem; text-align: center; color: red;">エラーが発生しました</div>';
    } finally {
        btnSearch.textContent = '🔍 検索';
        btnSearch.disabled = false;
    }
}

async function fetchLocationName(lat, lon) {
    // 1. キャッシュの確認 (APIの利用規約制限を避けるため)
    const cacheKey = `appare_loc_${lat.toFixed(4)}_${lon.toFixed(4)}`;
    const cachedName = localStorage.getItem(cacheKey);
    if (cachedName) {
        locationNameEl.textContent = `📍 ${cachedName}`;
        return;
    }
    
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=ja`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.address) {
            const ad = data.address;
            const name = ad.city || ad.town || ad.village || ad.county || ad.state || ad.country || "不明な地域";
            locationNameEl.textContent = `📍 ${name}`;
            localStorage.setItem(cacheKey, name); // キャッシュに保存
        } else {
            locationNameEl.textContent = `📍 緯度:${lat.toFixed(2)} 経度:${lon.toFixed(2)}`;
        }
    } catch (e) {
        locationNameEl.textContent = `📍 緯度:${lat.toFixed(2)} 経度:${lon.toFixed(2)}`;
    }
}

async function fetchWeather() {
    loading.classList.remove('hidden');
    forecastList.innerHTML = '';
    
    // 地名を取得して表示
    fetchLocationName(currentLat, currentLon);
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${currentLat}&longitude=${currentLon}&hourly=precipitation_probability,precipitation,weathercode,temperature_2m&timezone=auto&forecast_hours=36`;
    const cacheKey = `appare_weather_${currentLat.toFixed(2)}_${currentLon.toFixed(2)}`;
    const cacheTimeKey = `${cacheKey}_time`;
    
    // 2. 天気APIのキャッシュ確認 (15分以内なら再利用)
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);
    const now = Date.now();
    
    if (cachedData && cachedTime && (now - parseInt(cachedTime)) < 15 * 60 * 1000) {
        processWeatherData(JSON.parse(cachedData).hourly);
        loading.classList.add('hidden');
        return;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('API fetching failed');
        const data = await response.json();
        
        // 成功したらキャッシュを更新
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheTimeKey, now.toString());
        
        processWeatherData(data.hourly);
    } catch (error) {
        console.error('Error fetching weather:', error);
        // エラー時（オフライン時など）でも、古いキャッシュがあれば表示して繋ぐ
        if (cachedData) {
            processWeatherData(JSON.parse(cachedData).hourly);
        } else {
            forecastList.innerHTML = '<div style="text-align:center;color:red;">データの取得に失敗しました</div>';
        }
    } finally {
        loading.classList.add('hidden');
    }
}

function processWeatherData(hourly) {
    const times = hourly.time;
    const probs = hourly.precipitation_probability;
    const precip = hourly.precipitation;
    
    forecastList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    // 取得したデータの中で「一番最初にある偶数時間」を開始位置にする
    // (Open-Meteoは現在時刻からデータを返すため、現在が奇数時間だと配列の最初が奇数時間になる)
    let startIndex = 0;
    for (let i = 0; i < times.length; i++) {
        const timeStr = times[i];
        const hour = parseInt(timeStr.substring(11, 13), 10);
        if (hour % 2 === 0) {
            startIndex = i;
            break;
        }
    }
    
    // 36時間分（18件）、2時間おきに処理
    for (let i = startIndex; i < startIndex + 36 && i < times.length; i += 2) {
        const timeStr = times[i];
        const prob = probs[i];
        const amount = precip[i];
        
        const isFirst = (i === startIndex);
        renderItem(timeStr, prob, amount, isFirst, fragment);
    }
    
    forecastList.appendChild(fragment);
}

function renderItem(timeStr, prob, amount, isFirst, fragment) {
    const isRain = prob >= 30;
    
    // 時間のフォーマット (例: 7/5 14:00)
    const datePart = timeStr.split('T')[0];
    const timePart = timeStr.split('T')[1];
    const [yearStr, monthStr, dayStr] = datePart.split('-');
    const [hourStr, minStr] = timePart.split(':');
    
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const hourNum = parseInt(hourStr, 10);
    
    let timeDisplay = `${month}/${day} ${hourStr}:${minStr}`;
    
    // 特定の時間帯を強調 (6, 8, 10, 12, 14, 16時)
    const isHighlightHour = [6, 8, 10, 12, 14, 16].includes(hourNum);
    
    // 行ごとのカッパアイコン判定
    let rowKappaSrc = 'icon_normal.png';
    let rowKappaClass = 'row-kappa-normal';
    let kappaStyle = '';
    let extraHtml = '';
    
    if (amount >= 30) {
        rowKappaSrc = 'icon_dancing.png';
        rowKappaClass = 'row-kappa-runaway';
        // 画面外のランダムな方向へ吹っ飛ぶための座標を計算 (-800px 〜 800px)
        const flyX = (Math.random() - 0.5) * 1600;
        const flyY = (Math.random() - 0.5) * 1600 - 200; // 少し上方向にバイアス
        kappaStyle = `style="--fly-x: ${flyX}px; --fly-y: ${flyY}px;"`;
        extraHtml = '<div class="puddle"></div>'; // 水溜りを設置
    } else if (prob === 100 && amount >= 0.6) {
        rowKappaSrc = 'icon_dancing.png';
        rowKappaClass = 'row-kappa-breakdance';
    } else if (prob > 40 && amount >= 0.6) {
        rowKappaSrc = 'icon_dancing.png';
        rowKappaClass = 'row-kappa-dance';
        // 確率に応じてダンスの激しさ（速度）にグラデーションをつける (41%で1.2秒, 99%で0.4秒)
        const speed = 1.2 - ((prob - 40) / 59) * 0.8;
        kappaStyle = `style="animation-duration: ${speed}s;"`;
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
    div.className = classes;
    
    // 最初のアイテムの場合、6:00(および18:00)が左端(1列目)になるように列をオフセットする
    if (isFirst) {
        const col = ((hourNum - 6 + 24) % 12) / 2 + 1;
        div.style.gridColumnStart = col;
    }
    
    div.innerHTML = `
        <div class="time-container">
            <div class="time">${timeDisplay}</div>
            ${extraHtml}
            <img src="${rowKappaSrc}" class="row-kappa ${rowKappaClass}" alt="" ${kappaStyle}>
        </div>
        <div class="primary-info">
            <div class="info-label">降水確率</div>
            <div class="prob">${prob}<small>%</small></div>
            <div class="info-label">降水量</div>
            <div class="amount">${amount.toFixed(1)} mm</div>
        </div>
    `;
    
    fragment.appendChild(div);
}

// 起動
init();
