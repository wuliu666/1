// 🛡️ 全局 XSS 防御盾：彻底隔离注入攻击
function escapeHTML(str) {
    if (typeof str !== 'string') return String(str || '');
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// =========================================================================
// 💡 极客级无感拦截引擎：将【个人素材库】悄悄转移到本地浏览器 IndexedDB
// =========================================================================
const LOCAL_DB_NAME = 'NineRainLocalAssetsDB';
let localDBInstance = null;

function initLocalDB() {
    return new Promise((resolve) => {
        const req = indexedDB.open(LOCAL_DB_NAME, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        };
        req.onsuccess = e => { localDBInstance = e.target.result; resolve(); };
        req.onerror = () => resolve();
    });
}
initLocalDB();

const localDB = {
    save: async (asset) => new Promise(r => { const tx = localDBInstance.transaction('assets', 'readwrite'); tx.objectStore('assets').put(asset); tx.oncomplete = () => r(true); }),
    getAll: async () => new Promise(r => { const tx = localDBInstance.transaction('assets', 'readonly'); const req = tx.objectStore('assets').getAll(); req.onsuccess = () => r(req.result.sort((a,b)=>b.created_at - a.created_at)); }),
    delete: async (ids) => new Promise(r => { const tx = localDBInstance.transaction('assets', 'readwrite'); const store = tx.objectStore('assets'); ids.forEach(id => store.delete(id)); tx.oncomplete = () => r(true); })
};

// ⚡ 注意：必须把这里的 IP 替换为您真实的公网 IP！
const API_BASE_URL = "http://127.0.0.1:5000"; 
const HUB_ID = 'STORYBOARD_HUB'; 
const IMAGE_SPLIT_ID = 'IMAGE_SPLIT_TOOL';
const IMAGE_GEN_ID = 'IMAGE_GEN_TOOL'; 
const TEAM_ASSET_ID = 'TEAM_ASSET_LIBRARY';
const PERSONAL_ASSET_ID = 'PERSONAL_ASSET_LIBRARY';

let currentUserKey = null; let currentSessionToken = null; let heartbeatInterval = null;
let currentUserName = "Creator"; let isAdmin = false; 
let chats = []; let currentChatId = null; let renamingChatId = null; let currentTab = 'all'; let pendingConfirmCallback = null;
let currentUploadedImages = []; let currentSelectedRatioText = '16:9'; let currentSelectedResText = '高清 2K';
let teamAssets = []; let personalAssets = []; let currentAssetFilter = 'all'; let currentLibraryMode = 'team'; 
let editingAssetId = null; let isBulkMode = false; let selectedAssetIds = new Set();

let userUsages = JSON.parse(localStorage.getItem('sys_user_usages')) || {};

let dynamicModels = JSON.parse(localStorage.getItem('sys_dynamic_models')) || {
    gemini: [ {id:'gemini-3.1-flash', name:'⚡ Gemini 3.1 Flash'}, {id:'gemini-3.1-pro', name:'👑 Gemini 3.1 Pro'} ],
    geeknow: [ {id:'gemini-3-pro-preview', name:'🔥 Gemini 3 Pro Preview'}, {id:'gemini-2.5-flash-lite-preview-06-17-thinking', name:'🧠 Gemini 2.5 Flash Lite Thinking'} ],
    grsai: [ {id:'gpt-4-turbo', name:'🚀 GPT-4 Turbo'} ],
    image: [ {id:'nanopro', name:'👑 Nano Banana Pro'}, {id:'nano2', name:'🍌 Nano Banana 2'} ]
};

function addAuditLog(action, user = currentUserKey) { 
    fetch(`${API_BASE_URL}/api/log_action`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({user_key: user || 'System', action: action}) }).catch(()=>{}); 
}
function getUserUsage(key) { if(!userUsages[key]) userUsages[key] = { images: 0, limit: 1000 }; return userUsages[key]; }
function incrementUsage(key) { let u = getUserUsage(key); u.images += 1; localStorage.setItem('sys_user_usages', JSON.stringify(userUsages)); }

function showToast(msg) { const div = document.createElement('div'); div.className = 'toast-msg'; div.innerText = msg; document.body.appendChild(div); setTimeout(() => { if (div.parentNode) div.remove(); }, 2500); }

function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(() => { showToast("✅ 已成功复制到剪贴板"); }).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
}
function fallbackCopy(text) {
    const textArea = document.createElement("textarea"); textArea.value = text; textArea.style.position = "fixed"; textArea.style.left = "-9999px"; textArea.style.top = "0"; document.body.appendChild(textArea); textArea.focus(); textArea.select();
    try { document.execCommand('copy'); showToast("✅ 已成功复制到剪贴板"); } catch (err) { showToast("❌ 复制失败"); } document.body.removeChild(textArea);
}

async function fetchTeamAssets() { try { const res = await fetch(`${API_BASE_URL}/api/get_assets`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({library_mode: 'team'}) }); teamAssets = res.ok ? await res.json() : []; } catch(e) { teamAssets = []; } }
async function fetchPersonalAssets() { try { const res = await fetch(`${API_BASE_URL}/api/get_assets`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({library_mode: 'personal', user_key: currentUserKey}) }); personalAssets = res.ok ? await res.json() : []; } catch(e) { personalAssets = []; } }

async function fetchCloudChats(key) {
    try { const res = await fetch(`${API_BASE_URL}/api/get_chats`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({user_key: key}) }); if(res.ok) { const cloudChats = await res.json(); if(cloudChats && cloudChats.length > 0) { chats = cloudChats; localStorage.setItem('chats_' + key, JSON.stringify(chats)); } } } catch(e) {}
}

async function syncChatsToCloud() { if(!currentUserKey) return; try { await fetch(`${API_BASE_URL}/api/save_chats`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({user_key: currentUserKey, chats: chats}) }); } catch(e) {} }

let isSidebarCollapsed = window.innerWidth <= 768; 
window.addEventListener('DOMContentLoaded', () => { if(isSidebarCollapsed) document.getElementById('appSidebar')?.classList.add('collapsed'); });

function toggleSidebar() { 
    isSidebarCollapsed = !isSidebarCollapsed; const sidebar = document.getElementById('appSidebar'); const overlay = document.getElementById('mobileOverlay');
    if(isSidebarCollapsed) { sidebar.classList.add('collapsed'); if(overlay) overlay.classList.remove('show'); } 
    else { sidebar.classList.remove('collapsed'); if(window.innerWidth <= 768 && overlay) overlay.classList.add('show'); } 
}

function init() {
    loadImageModelsToUI();
    const lastKey = localStorage.getItem('last_used_key'); if (lastKey) document.getElementById('secretKey').value = lastKey;
    const k = localStorage.getItem('user_secret_key');
    if (k) { 
        document.getElementById('secretKey').value = k; 
        verifyKey(); 
    } else { 
        document.getElementById('keySection').style.display = 'flex'; 
        document.getElementById('chatList').innerHTML = ''; 
        document.getElementById('chatBox').innerHTML = ''; 
    }
}

function toggleKeyVisibility() { const el = document.getElementById('secretKey'); el.type = el.type === 'password' ? 'text' : 'password'; }
function clearKeyInput() { document.getElementById('secretKey').value = ''; document.getElementById('secretKey').type = 'password'; }
function onApiSourceChange() {
    const source = document.getElementById('apiSourceSelect').value; const ms = document.getElementById('modelSelect'); ms.innerHTML = '';
    // 自动过滤，确保标记为“生图”的模型绝对不会出现在普通文本聊天框里
    if(dynamicModels[source] && dynamicModels[source].length > 0) { 
        dynamicModels[source].filter(m => !m.type || m.type === 'chat').forEach(m => ms.innerHTML += `<option value="${m.id}">${m.name}</option>`); 
    } 
    if(ms.innerHTML === '') { ms.innerHTML = `<option value="">无可用对话模型</option>`; }
    if(currentUserKey) { localStorage.setItem('api_source_' + currentUserKey, source); changeModel(); }
}
function changeModel() { if(currentUserKey) localStorage.setItem('model_type_' + currentUserKey, document.getElementById('modelSelect').value); }

function loadImageModelsToUI() { 
    const is = document.getElementById('imgGenModelSelect'); 
    if(!is) return;
    is.innerHTML = ''; 
    let hasImageModels = false;
    
    // 生图控制台仅读取 dynamicModels.image 这个独立池子里的数据
    if(dynamicModels.image && dynamicModels.image.length > 0) {
        dynamicModels.image.forEach(m => {
            const boundSource = m.source || 'geeknow';
            // 将绑定的通道源藏进 value 里（格式： 通道:::模型），后端生图时直接解析！
            is.innerHTML += `<option value="${boundSource}:::${m.id}">${m.name}</option>`;
            hasImageModels = true;
        });
    }
    
    if(!hasImageModels) {
        is.innerHTML = `<option value="">未配置生图模型</option>`;
    }
}

async function checkHeartbeat() {
    if(!currentUserKey || !currentSessionToken) return;
    const deviceType = window.innerWidth <= 768 ? 'mobile' : 'desktop';
    try {
        const res = await fetch(`${API_BASE_URL}/api/heartbeat`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_key: currentUserKey, session_token: currentSessionToken, device_type: deviceType}) });
        const d = await res.json();
        if(!d.valid) { forceLogout("检测到您的账号已在其他相同类型设备登入，您已被安全挤下线！\n（您的密钥已保留，重新验证即可恢复）"); }
    } catch(e) {}
}

function forceLogout(alertMsg) {
    if(heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    currentUserKey = null; currentSessionToken = null;
    document.getElementById('keySection').style.display = 'flex'; document.getElementById('headerActions').style.display = 'none'; document.getElementById('chatBox').innerHTML = ''; document.getElementById('chatList').innerHTML = ''; document.getElementById('inputSection').style.display = 'none'; document.getElementById('imageGenInputSection').style.display = 'none'; document.getElementById('exportPdfBtn').style.display = 'none';
    if(alertMsg) alert(alertMsg);
    if (window.innerWidth <= 768) { isSidebarCollapsed = true; document.getElementById('appSidebar').classList.add('collapsed'); const overlay = document.getElementById('mobileOverlay'); if(overlay) overlay.classList.remove('show'); }
}

async function verifyKey() {
    const p = document.getElementById('secretKey').value.trim(); if(!p) return;
    const btn = document.querySelector('.key-section .btn-confirm'); const originalText = btn.innerText; btn.innerText = "验证中..."; btn.disabled = true;
    currentSessionToken = generateSecureToken();
    const deviceType = window.innerWidth <= 768 ? 'mobile' : 'desktop';

    try {
        const res = await fetch(`${API_BASE_URL}/verify`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user_key:p, session_token: currentSessionToken, device_type: deviceType}) });
        const d = await res.json();
        if(res.ok) {
            localStorage.setItem('user_secret_key', p); localStorage.setItem('last_used_key', p); currentUserKey = p; isAdmin = d.is_admin; currentUserName = d.note || "Creator";
            if(heartbeatInterval) clearInterval(heartbeatInterval); heartbeatInterval = setInterval(checkHeartbeat, 8000);
            
            await fetchCloudChats(p);
            Promise.all([fetchTeamAssets(), fetchPersonalAssets()]).then(() => { if (currentChatId === TEAM_ASSET_ID || currentChatId === PERSONAL_ASSET_ID) { renderAssetGrid(); } });
            
            chats = JSON.parse(localStorage.getItem('chats_' + currentUserKey)) || [];
            if (!chats.find(c => c.id === IMAGE_GEN_ID)) { chats.push({id: IMAGE_GEN_ID, title: "AI生图记录", messages: [], isImageGen: true}); saveChats(); }
            getUserUsage(p); localStorage.setItem('sys_user_usages', JSON.stringify(userUsages));
            
            // 收到云端的全局模型包后直接全覆盖！
            if (d.dynamic_models && Object.keys(d.dynamic_models).length > 0) {
                dynamicModels = d.dynamic_models;
            }
            if (!dynamicModels.image || dynamicModels.image.length === 0) { dynamicModels.image = [ {id:'nanopro', name:'👑 Nano Banana Pro'} ]; }
            loadImageModelsToUI();

            const sourceSelect = document.getElementById('apiSourceSelect');
            sourceSelect.innerHTML = '';
            if (d.channels_list && d.channels_list.length > 0) {
                d.channels_list.forEach(ch => { sourceSelect.innerHTML += `<option value="${ch.id}">${ch.name}</option>`; });
            } else { sourceSelect.innerHTML = '<option value="gemini">🌐 Gemini</option>'; }

            let savedSource = localStorage.getItem('api_source_' + currentUserKey);
            if (!savedSource || !sourceSelect.querySelector(`option[value="${savedSource}"]`)) { savedSource = sourceSelect.options.length > 0 ? sourceSelect.options[0].value : 'gemini'; }
            sourceSelect.value = savedSource; onApiSourceChange(); 
            
            const savedModel = localStorage.getItem('model_type_' + currentUserKey);
            if (savedModel && dynamicModels[savedSource] && dynamicModels[savedSource].find(m => m.id === savedModel)) { document.getElementById('modelSelect').value = savedModel; }
            
            document.getElementById('keySection').style.display = 'none'; document.getElementById('headerActions').style.display = 'flex'; document.getElementById('adminBtn').style.display = isAdmin ? 'inline-block' : 'none'; addAuditLog('登录系统'); switchChat(HUB_ID);
        } else { 
                    showToast("请联系管理员！"); 
                    document.getElementById('keySection').style.display = 'flex';
                }
            } catch(e) { 
                showToast("网络连接失败，请确保服务器正常运行！"); 
                document.getElementById('keySection').style.display = 'flex';
            } finally { 
                btn.innerText = originalText; btn.disabled = false; 
            }
}

function logout() { openConfirmModal(() => { addAuditLog('退出登录'); forceLogout("您已安全登出！"); localStorage.removeItem('user_secret_key'); }); }
function openChangeKeyModal() { document.getElementById('newKeyInput').value = currentUserKey; document.getElementById('changeKeyModal').classList.add('show'); }
function closeChangeKeyModal() { document.getElementById('changeKeyModal').classList.remove('show'); }
async function confirmChangeKey() {
    const nk = document.getElementById('newKeyInput').value.trim(); if(!nk || nk === currentUserKey) return alert("请输入一个全新的专属密钥！");
    const btn = document.querySelector('#changeKeyModal .btn-confirm'); const originalText = btn.innerText; btn.innerText = "正在搬家中..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/api/change_key`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({old_key: currentUserKey, new_key: nk}) });
        const d = await res.json();
        if(res.ok && d.success) {
            const oldChats = localStorage.getItem('chats_' + currentUserKey); if(oldChats) { localStorage.setItem('chats_' + nk, oldChats); localStorage.removeItem('chats_' + currentUserKey); }
            const oldSource = localStorage.getItem('api_source_' + currentUserKey); if(oldSource) { localStorage.setItem('api_source_' + nk, oldSource); localStorage.removeItem('api_source_' + currentUserKey); }
            const oldModel = localStorage.getItem('model_type_' + currentUserKey); if(oldModel) { localStorage.setItem('model_type_' + nk, oldModel); localStorage.removeItem('model_type_' + currentUserKey); }
            localStorage.setItem('user_secret_key', nk); localStorage.setItem('last_used_key', nk); currentUserKey = nk; showToast("✅ 密钥修改成功！数据已全部迁移"); closeChangeKeyModal();
        } else { alert(d.error || "修改失败，可能是因为新密钥已被其他人占用！"); }
    } catch(e) { alert("网络连接错误，请稍后再试！"); } finally { btn.innerText = originalText; btn.disabled = false; }
}

window.copyAdminKey = function(text, btn) { copyToClipboard(text); const original = btn.innerHTML; btn.innerHTML = '✅ 已复制'; btn.style.color = '#ffffff'; btn.style.backgroundColor = '#34c759'; btn.style.borderColor = '#34c759'; setTimeout(() => { btn.innerHTML = original; btn.style.color = ''; btn.style.backgroundColor = ''; btn.style.borderColor = ''; }, 2000); };

// 💡 全局拦截原生的顶部 alert 弹窗，将其强制替换为您写好的居中 Toast
window.alert = function(msg) { showToast(msg); };

function openConfirmModal(callback, customText) { 
    pendingConfirmCallback = callback; 
    const p = document.querySelector('#confirmModal p');
    if (p) p.innerHTML = customText || "您确定要执行此操作吗？";
    document.getElementById('confirmModal').classList.add('show'); 
}
function closeConfirmModal() { document.getElementById('confirmModal').classList.remove('show'); pendingConfirmCallback = null; }
function executeConfirm() { if(pendingConfirmCallback) pendingConfirmCallback(); closeConfirmModal(); }

// =============== 扩展通道 UI 生成 ===============

function renderChannelModels(channelId) {
    const container = document.getElementById(`modelList-${channelId}`);
    if (!container) return;
    container.innerHTML = '';
    const models = dynamicModels[channelId] || [];
    if(models.length === 0) { container.innerHTML = `<span style="font-size:0.8rem; color:var(--text-secondary);">暂无模型，请添加</span>`; return; }
    models.forEach(m => {
        const icon = m.type === 'image' ? '🎨' : '💬';
        container.innerHTML += `<div style="background:var(--bg-user-msg); color:white; border-radius:15px; padding:4px 10px; font-size:0.8rem; display:flex; align-items:center; gap:6px;"><span>${icon} ${m.name}</span><span style="cursor:pointer; color:#ffb3b3; font-weight:bold;" onclick="removeChannelModel('${channelId}', '${m.id}')" title="移除此模型">×</span></div>`;
    });
}

function addChannelModel(channelId) {
    const idInput = document.getElementById(`newModelId-${channelId}`);
    const nameInput = document.getElementById(`newModelName-${channelId}`);
    const typeInput = document.getElementById(`newModelType-${channelId}`);
    const id = idInput.value.trim(); const name = nameInput.value.trim();
    const type = typeInput ? typeInput.value : 'chat';
    if(!id || !name) return alert('请填写完整的模型标识和显示名');
    if(!dynamicModels[channelId]) dynamicModels[channelId] = [];
    if(dynamicModels[channelId].find(m => m.id === id)) return alert('该模型标识已存在！');
    dynamicModels[channelId].push({id, name, type});
    idInput.value = ''; nameInput.value = '';
    renderChannelModels(channelId); onApiSourceChange(); 
    if(typeof updateImageModelDropdown === 'function') updateImageModelDropdown();
}

function removeChannelModel(channelId, modelId) {
    if(!dynamicModels[channelId]) return;
    dynamicModels[channelId] = dynamicModels[channelId].filter(m => m.id !== modelId);
    renderChannelModels(channelId); onApiSourceChange();
    if(typeof updateImageModelDropdown === 'function') updateImageModelDropdown();
}

function updateAdminModelFilterUI(custom_channels = []) {
    const filter = document.getElementById('newImageModelSource');
    if(!filter) return;
    const currentVal = filter.value;
    let optionsHTML = `
        <option value="geeknow">🚀 GeekNow 中转</option>
        <option value="grsai">⚡ GRSAI 中转</option>
        <option value="gemini">🌐 官方 Gemini 直连</option>
    `;
    if (custom_channels && custom_channels.length > 0) {
        custom_channels.forEach(cc => {
            optionsHTML += `<option value="${cc.id}">🔌 ${cc.name} (自定义)</option>`;
            if (!dynamicModels[cc.id]) dynamicModels[cc.id] = [];
        });
    }
    filter.innerHTML = optionsHTML;
    localStorage.setItem('sys_dynamic_models', JSON.stringify(dynamicModels));
    filter.value = Array.from(filter.options).some(o => o.value === currentVal) ? currentVal : 'geeknow';
    
    updateImageModelDropdown();
    renderAdminModels();
}

function updateImageModelDropdown() {
    const filter = document.getElementById('newImageModelSource');
    const idSelect = document.getElementById('newImageModelId');
    if(!filter || !idSelect) return;
    const channelId = filter.value;
    const models = dynamicModels[channelId] || [];
    const imageModels = models.filter(m => m.type === 'image'); // 精准筛选出生图模型
    
    idSelect.innerHTML = '';
    if(imageModels.length === 0) {
        idSelect.innerHTML = '<option value="">⚠️ 此通道下暂无生图模型</option>';
    } else {
        imageModels.forEach(m => {
            idSelect.innerHTML += `<option value="${m.id}">${m.id} (${m.name})</option>`;
        });
    }
}

function addCustomChannelUI(data = null) {
    const container = document.getElementById('customChannelsContainer');
    const id = data ? data.id : 'custom_' + Date.now();
    const name = data ? data.name : '未命名新通道';
    const url = data ? data.base_url : '';
    const key = data ? data.api_key : '';
    const enabled = data ? (data.enabled !== false) : true;
    
    const safeName = escapeHTML(name);

    const html = `
        <div class="custom-channel-block" data-id="${id}" style="border: 1px solid var(--border-color); border-radius: 10px; padding: 15px; margin-bottom: 12px; background: var(--bg-container); position: relative;">
            <button onclick="this.parentElement.remove()" style="position: absolute; top: 12px; right: 12px; background: none; border: none; color: var(--danger-color); cursor: pointer; font-size: 1.2rem;" title="删除此通道">🗑️</button>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-right: 35px;">
                <h4 style="margin: 0; display:flex; align-items:center; color: var(--text-main);">🔌 <input type="text" class="cc-name" value="${safeName}" placeholder="通道名称" style="border:none; border-bottom:1px dashed var(--text-secondary); background:transparent; color:var(--text-main); font-weight:bold; font-size:1rem; outline:none; margin-left: 5px; width: 140px;"></h4>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 0.85rem;"><input type="checkbox" class="cc-enable" ${enabled ? 'checked' : ''}> 启用</label>
            </div>
            <div class="setting-row"><label>🔗 Base URL</label><input type="text" class="cc-url" value="${escapeHTML(url)}" placeholder="https://api.xxx.com/v1"></div>
            <div class="setting-row"><label>🔑 API Key</label><input type="text" class="cc-key" value="${key}" placeholder="sk-..." title="系统已开启高级安全脱敏保护"></div>
            <div style="display: flex; gap: 10px; margin-top: 5px;">
                <button class="nav-btn" onclick="testCustomConnection('${id}', this)" style="flex: 1;">⚡ 连通性测试</button>
                <button class="nav-btn" onclick="checkCustomBalance('${id}', this)" style="flex: 1; border-color: #ff9500; color: #ff9500;">💰 查询余额</button>
            </div>
            <div style="margin-top: 15px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">📦 挂载底层模型池：</div>
                    <div id="modelList-${id}" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;"></div>
                    <div style="display: flex; gap: 6px;">
                        <select id="newModelType-${id}" style="padding:6px; border-radius:6px; border:1px solid var(--border-color); font-size:0.8rem; background:var(--bg-input); color:var(--text-main); outline:none;"><option value="chat">💬 对话</option><option value="image">🎨 生图</option></select>
                        <input type="text" id="newModelId-${id}" placeholder="底层标识" style="flex:1; padding:6px; border-radius:6px; border:1px solid var(--border-color); font-size:0.8rem; background:var(--bg-input); color:var(--text-main);">
                        <input type="text" id="newModelName-${id}" placeholder="别名" style="flex:1; padding:6px; border-radius:6px; border:1px solid var(--border-color); font-size:0.8rem; background:var(--bg-input); color:var(--text-main);">
                        <button class="nav-btn" onclick="addChannelModel('${id}')" style="padding: 6px 12px; font-size:0.85rem;">➕ 录入</button>
                    </div>
                </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
    renderChannelModels(id);
}

async function loadApiSettings() { 
    try { 
        const res = await fetch(`${API_BASE_URL}/admin/get_config`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key: currentUserKey}) }); 
        if(res.ok) { 
            const d = await res.json(); 
            document.getElementById('geminiEnable').checked = d.gemini_enabled !== false;
            document.getElementById('geminiKey').value = d.gemini_key || ''; 
            document.getElementById('geminiProxy').value = d.gemini_proxy || ''; 
            document.getElementById('geeknowEnable').checked = d.geeknow_enabled !== false;
            document.getElementById('geeknowKey').value = d.geeknow_key || ''; 
            document.getElementById('geeknowUrl').value = d.geeknow_url || 'https://www.geeknow.top/v1'; 
            document.getElementById('grsaiEnable').checked = d.grsai_enabled !== false;
            document.getElementById('grsaiKey').value = d.grsai_key || ''; 
            document.getElementById('grsaiUrl').value = d.grsai_url || 'https://api.grsai.com/v1'; 
            
            if(d.dynamic_models && Object.keys(d.dynamic_models).length > 0) { dynamicModels = d.dynamic_models; }

            document.getElementById('customChannelsContainer').innerHTML = '';
            if(d.custom_channels) d.custom_channels.forEach(cc => addCustomChannelUI(cc));
            
            renderChannelModels('gemini'); renderChannelModels('geeknow'); renderChannelModels('grsai');
            
            // 关键修复：拉取配置后，立即把通道列表注入到“生图控制台”的下拉选择框中
            if(typeof updateAdminModelFilterUI === 'function') {
                updateAdminModelFilterUI(d.custom_channels || []);
            }
        } 
    } catch(e) {} 
}

async function saveApiSettings() { 
    const customBlocks = document.querySelectorAll('.custom-channel-block'); const custom_channels = [];
    customBlocks.forEach(block => {
        custom_channels.push({ id: block.getAttribute('data-id'), name: block.querySelector('.cc-name').value.trim() || '未命名通道', base_url: block.querySelector('.cc-url').value.trim(), api_key: block.querySelector('.cc-key').value.trim(), enabled: block.querySelector('.cc-enable').checked });
    });

    const payload = { 
        admin_key: currentUserKey, 
        gemini_enabled: document.getElementById('geminiEnable').checked, gemini_key: document.getElementById('geminiKey').value.trim(), gemini_proxy: document.getElementById('geminiProxy').value.trim(),
        geeknow_enabled: document.getElementById('geeknowEnable').checked, geeknow_url: document.getElementById('geeknowUrl').value.trim(), geeknow_key: document.getElementById('geeknowKey').value.trim(), 
        grsai_enabled: document.getElementById('grsaiEnable').checked, grsai_url: document.getElementById('grsaiUrl').value.trim(), grsai_key: document.getElementById('grsaiKey').value.trim(),
        custom_channels: custom_channels, dynamic_models: dynamicModels
    }; 
    try { 
        await fetch(`${API_BASE_URL}/admin/save_config`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); 
        showToast("✅ 接口通道及模型已云端保存，所有成员将同步生效！"); addAuditLog('全局修改了通道接口与模型分配'); 
        
        // 关键修复：保存通道修改后，实时刷新生图控制台的下拉通道选项
        if(typeof updateAdminModelFilterUI === 'function') {
            updateAdminModelFilterUI(custom_channels);
        }
    } catch(e) { alert("保存失败"); } 
}

function exportApiConfig() {
    fetch(`${API_BASE_URL}/admin/export_config`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key: currentUserKey}) })
    .then(res => res.json()).then(d => {
        if(d.success) {
            const blob = new Blob([JSON.stringify(d.config, null, 2)], {type: "application/json"});
            const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `API通道备份_${new Date().getTime()}.json`; link.click();
            addAuditLog('导出了全站通道配置备份');
        } else alert("导出失败");
    });
}

function triggerImportConfig() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const config = JSON.parse(ev.target.result);
                const res = await fetch(`${API_BASE_URL}/admin/import_config`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key: currentUserKey, config: config}) });
                const d = await res.json();
                if(d.success) { showToast("✅ 备份导入成功！即将刷新..."); addAuditLog('通过 JSON 文件覆盖了通道配置'); setTimeout(() => location.reload(), 1500); } 
                else alert("导入失败");
            } catch(err) { alert("文件损坏或非合法 JSON！"); }
        }; reader.readAsText(file);
    }; input.click();
}

async function testApiConnection(channel) {
    const btn = document.getElementById(`btnTest-${channel}`); const originalText = btn.innerHTML; btn.innerHTML = "⏳ 测试中..."; btn.disabled = true;
    let key = document.getElementById(`${channel}Key`).value.trim(); let url = channel === 'gemini' ? '' : document.getElementById(`${channel}Url`).value.trim();
    let proxy = channel === 'gemini' ? document.getElementById('geminiProxy').value.trim() : '';
    if (!key) { alert("⚠️ 请先填写 API Key！"); btn.innerHTML = originalText; btn.disabled = false; return; }
    try {
        const res = await fetch(`${API_BASE_URL}/admin/test_api`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ admin_key: currentUserKey, channel: channel, api_key: key, base_url: url, proxy: proxy }) });
        const d = await res.json();
        if (d.success) { btn.innerHTML = "✅ 测试通过！"; btn.style.cssText = "width:100%; margin-top:5px; background:#34c759; color:white; border-color:#34c759;"; } else { btn.innerHTML = "❌ 测试失败"; alert(d.msg); }
    } catch (e) { btn.innerHTML = "❌ 网络异常"; } setTimeout(() => { btn.innerHTML = originalText; btn.style.cssText = "width:100%; margin-top:5px;"; btn.disabled = false; }, 3500);
}

async function checkBalance(channel) {
    const btn = document.getElementById(`btnBal-${channel}`); const originalText = btn.innerHTML; btn.innerHTML = "⏳ 查询中..."; btn.disabled = true;
    let key = document.getElementById(`${channel}Key`).value.trim(); let url = document.getElementById(`${channel}Url`).value.trim();
    if (!key) { alert("⚠️ 请先填写 API Key！"); btn.innerHTML = originalText; btn.disabled = false; return; }
    try {
        const res = await fetch(`${API_BASE_URL}/admin/check_balance`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ admin_key: currentUserKey, api_key: key, base_url: url }) });
        const d = await res.json();
        if (d.success) { btn.innerHTML = typeof d.balance === 'number' ? `💲 余额: $${d.balance.toFixed(4)}` : `✅ ${d.balance}`; btn.style.cssText = "flex:1; background:var(--bg-hover); color:var(--text-main); border-color:var(--border-color);"; } else { btn.innerHTML = "❌ 查询失败"; alert(d.msg); }
    } catch (e) { btn.innerHTML = "❌ 网络异常"; } setTimeout(() => { btn.innerHTML = originalText; btn.style.cssText = "flex:1; border-color:#ff9500; color:#ff9500;"; btn.disabled = false; }, 4000);
}

async function testCustomConnection(id, btn) {
    const block = btn.parentElement.parentElement; const url = block.querySelector('.cc-url').value.trim(); const key = block.querySelector('.cc-key').value.trim();
    const originalText = btn.innerHTML; if (!key || !url) { alert("⚠️ 必须填写 Base URL 和 API Key！"); return; } btn.innerHTML = "⏳ 测试中..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/admin/test_api`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ admin_key: currentUserKey, channel: 'custom', api_key: key, base_url: url }) });
        const d = await res.json();
        if (d.success) { btn.innerHTML = "✅ 连通正常！"; btn.style.cssText = "flex:1; background:#34c759; color:white; border-color:#34c759;"; } else { btn.innerHTML = "❌ 测试失败"; alert(d.msg); }
    } catch (e) { btn.innerHTML = "❌ 网络异常"; } setTimeout(() => { btn.innerHTML = originalText; btn.style.cssText = "flex:1;"; btn.disabled = false; }, 3500);
}

async function checkCustomBalance(id, btn) {
    const block = btn.parentElement.parentElement; const url = block.querySelector('.cc-url').value.trim(); const key = block.querySelector('.cc-key').value.trim();
    const originalText = btn.innerHTML; if (!key || !url) { alert("⚠️ 必须填写 Base URL 和 API Key！"); return; } btn.innerHTML = "⏳ 查询中..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/admin/check_balance`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ admin_key: currentUserKey, api_key: key, base_url: url }) });
        const d = await res.json();
        if (d.success) { btn.innerHTML = typeof d.balance === 'number' ? `💲 余额: $${d.balance.toFixed(4)}` : `✅ ${d.balance}`; btn.style.cssText = "flex:1; background:var(--bg-hover); color:var(--text-main); border-color:var(--border-color);"; } else { btn.innerHTML = "❌ 查询失败"; alert(d.msg); }
    } catch (e) { btn.innerHTML = "❌ 网络异常"; } setTimeout(() => { btn.innerHTML = originalText; btn.style.cssText = "flex:1; border-color:#ff9500; color:#ff9500;"; btn.disabled = false; }, 4000);
}

let targetQuotaKey = null;
function switchAdminTab(tabName) { 
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); 
    document.querySelectorAll('.admin-tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; }); 
    document.getElementById(`tabBtn-${tabName}`).classList.add('active'); 
    let targetTab = document.getElementById(`adminTab-${tabName}`); targetTab.classList.add('active'); targetTab.style.display = 'block'; 
    if(tabName === 'keys') refreshKeyList(); 
    if(tabName === 'models') { renderAdminModels(); loadApiSettings(); } 
    if(tabName === 'logs') renderAuditLogs(); 
    if(tabName === 'api') loadApiSettings(); 
}

async function openAdminPanel() { document.getElementById('adminModal').classList.add('show'); switchAdminTab('keys'); }
function closeAdminPanel() { document.getElementById('adminModal').classList.remove('show'); }

async function refreshKeyList() { 
    const ak = localStorage.getItem('user_secret_key'); const tb = document.getElementById('keyTableBody'); tb.innerHTML = ''; 
    try { 
        const res = await fetch(`${API_BASE_URL}/admin/list`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak}) }); 
        if(res.ok) { 
            const d = await res.json(); 
            for(let k in d.keys) { 
                // 🛡️ 修复：跳过当前管理员自己的密钥，并严格拦截系统全局配置对象，防止其被当做用户渲染
                if(k === ak || k === '__GLOBAL_CONFIG__') continue; 
                const info = d.keys[k]; const u = getUserUsage(k); const tr = document.createElement('tr'); 
                if(info.is_deleted) tr.className = 'status-del'; 
                tr.innerHTML = `
                    <td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-family: monospace; font-size: 0.95rem;">${k}</span>
                            <button class="admin-copy-btn" onclick="copyAdminKey('${k}', this)">📋 复制</button>
                        </div>
                    </td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color);">${info.note}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color); color: ${u.images >= u.limit ? 'var(--danger-color)' : 'inherit'}">${u.images} / ${u.limit} 张</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color); display: flex; gap: 6px; align-items: center;">
                        <button class="modal-btn" style="padding:4px 8px; font-size:12px; background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color);" onclick="openQuotaModal('${k}', ${u.limit})">额度</button>
                        <button class="modal-btn" style="padding:4px 8px; font-size:12px; background:${info.is_deleted?'#34c759':'#ff9500'}; color:white;" onclick="toggleKeyStatus('${k}')">${info.is_deleted?'恢复':'停用'}</button>
                        <button class="modal-btn" style="padding:4px 8px; font-size:12px; background:var(--danger-color); color:white;" onclick="hardDeleteKey('${k}')">彻底删除</button>
                    </td>`; 
                tb.appendChild(tr); 
            } 
        } 
    } catch(e) {} 
}

async function toggleKeyStatus(t) { const ak = localStorage.getItem('user_secret_key'); await fetch(`${API_BASE_URL}/admin/toggle_delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak, target_key:t}) }); addAuditLog(`更改了密钥状态: ${t}`); await refreshKeyList(); }
async function hardDeleteKey(t) { 
    openConfirmModal(async () => {
        const ak = localStorage.getItem('user_secret_key'); await fetch(`${API_BASE_URL}/admin/hard_delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak, target_key:t}) }); addAuditLog(`彻底删除了密钥: ${t}`); await refreshKeyList(); 
    }, '🚨 危险操作：确定要彻底删除吗？');
}
async function generateNewKey() { const ak = localStorage.getItem('user_secret_key'); const n = document.getElementById('newKeyNote').value.trim(); if(!n) return alert("请输入备注"); await fetch(`${API_BASE_URL}/admin/create`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak, note:n}) }); document.getElementById('newKeyNote').value = ''; addAuditLog(`生成了新密钥`); await refreshKeyList(); }
function openQuotaModal(key, currentLimit) { targetQuotaKey = key; document.getElementById('quotaInput').value = currentLimit; document.getElementById('quotaModal').classList.add('show'); }
function closeQuotaModal() { document.getElementById('quotaModal').classList.remove('show'); targetQuotaKey = null; }
function saveQuota() { const val = parseInt(document.getElementById('quotaInput').value); if(isNaN(val) || val < 0) return alert("请输入有效整数"); userUsages[targetQuotaKey].limit = val; localStorage.setItem('sys_user_usages', JSON.stringify(userUsages)); addAuditLog(`修改了额度为: ${val}`); closeQuotaModal(); refreshKeyList(); }
function renderAdminModels() { 
    const il = document.getElementById('imageModelList'); 
    if(!il) return;
    il.innerHTML = ''; 
    if(dynamicModels.image) { 
        dynamicModels.image.forEach(m => {
            const sourceNames = { gemini: '官方直连', geeknow: 'GeekNow', grsai: 'GRSAI' };
            const sName = sourceNames[m.source] || m.source || 'GeekNow';
            il.innerHTML += `<div style="background:var(--bg-input); padding:10px 14px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border-color); margin-bottom: 6px;"><span style="font-size:0.95rem; font-weight:500; color:var(--text-main);">${escapeHTML(m.name)} <span style="color:var(--text-secondary); font-size:0.8rem; margin-left:8px; font-family:monospace; font-weight:normal;">[${escapeHTML(m.id)}] (来源: ${escapeHTML(sName)})</span></span><button class="log-action-btn" style="color:var(--danger-color); padding:4px 8px; font-size:1.1rem;" onclick="removeModel('image', '${m.id}')" title="下架此模型">🗑️</button></div>`; 
        });
    } 
}

function addModel(type) { 
    if (type !== 'image') return;
    const sourceInput = document.getElementById('newImageModelSource');
    const id = document.getElementById('newImageModelId').value.trim(); 
    const name = document.getElementById('newImageModelName').value.trim(); 
    const source = sourceInput ? sourceInput.value : 'geeknow';
    if(!id || !name) return alert("⚠️ 请填写完整的底层接口标识和展示名称！"); 
    if(dynamicModels.image.find(m => m.id === id)) return alert("⚠️ 该模型标识已存在，无需重复添加！");
    
    dynamicModels.image.push({id, name, source}); 
    document.getElementById('newImageModelId').value = ''; 
    document.getElementById('newImageModelName').value = ''; 
    
    localStorage.setItem('sys_dynamic_models', JSON.stringify(dynamicModels)); 
    renderAdminModels(); 
    loadImageModelsToUI(); 
    saveApiSettings();
}

function removeModel(type, id) { 
    if(type !== 'image') return;
    if(dynamicModels.image.length <= 1) return alert("❌ 为了防止生图控制台崩溃，必须至少保留一个生图模型！"); 
    
    dynamicModels.image = dynamicModels.image.filter(m => m.id !== id); 
    localStorage.setItem('sys_dynamic_models', JSON.stringify(dynamicModels)); 
    renderAdminModels(); 
    loadImageModelsToUI(); 
    saveApiSettings();
}

let currentAuditLogsData = [];

function getActionBadge(action) {
    if (action.includes('删除') || action.includes('清空') || action.includes('高危')) return `<span style="color: #ff3b30; font-weight: bold;">🔴 ${action}</span>`;
    if (action.includes('登录') || action.includes('恢复') || action.includes('新增')) return `<span style="color: #34c759;">🟢 ${action}</span>`;
    if (action.includes('修改') || action.includes('更新') || action.includes('设置') || action.includes('配置')) return `<span style="color: #ff9500;">🟠 ${action}</span>`;
    if (action.includes('生成') || action.includes('生图') || action.includes('提取') || action.includes('拆分') || action.includes('下载') || action.includes('导出')) return `<span style="color: #af52de;">🟣 ${action}</span>`;
    return `<span>${action}</span>`;
}

function drawAuditLogTable(logs) {
    const tb = document.getElementById('auditLogTableBody'); 
    tb.innerHTML = '';
    
    // 动态渲染顶部统计大盘
    const stats = document.getElementById('auditStats');
    if (stats) {
        const todayStr = new Date().toISOString().split('T')[0]; // 获取 YYYY-MM-DD
        const todayCount = logs.filter(l => l.time.startsWith(todayStr)).length;
        const dangerCount = logs.filter(l => l.action.includes('删除') || l.action.includes('清空')).length;
        stats.innerHTML = `<span>📑 总记录数: ${logs.length}</span> <span style="color: #34c759;">📅 今日新增: ${todayCount}</span> <span style="color: #ff3b30;">🚨 风险操作: ${dangerCount}</span>`;
    }

    if(logs.length > 0) {
        logs.forEach(l => { 
            const badgeAction = getActionBadge(escapeHTML(l.action));
            const safeUser = escapeHTML(l.user);
            tb.innerHTML += `<tr style="transition: background 0.2s;" onmouseover="this.style.backgroundColor='var(--bg-hover)'" onmouseout="this.style.backgroundColor='transparent'"><td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: 0.8rem;">${escapeHTML(l.time)}</td><td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color);"><span style="background:var(--bg-input); padding:4px 8px; border-radius:6px; border:1px solid var(--border-color); font-family: monospace;">${safeUser.substring(0,8)}${safeUser.length>8?'...':''}</span></td><td style="padding: 12px 10px; border-bottom: 1px solid var(--border-color); color: var(--text-main); font-weight: 500;">${badgeAction}</td></tr>`; 
        });
    } else {
        tb.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:30px; color:var(--text-secondary);">☁️ 暂无相关记录</td></tr>';
    }
}
async function renderAuditLogs() { 
    const tb = document.getElementById('auditLogTableBody'); 
    tb.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-secondary);">⏳ 正在拉取云端日志...</td></tr>';
    try {
        const res = await fetch(`${API_BASE_URL}/admin/get_logs`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key: currentUserKey}) });
        const d = await res.json();
        if(d.success) {
            currentAuditLogsData = d.logs;
            filterAuditLogs(); // 结合当前的搜索框进行渲染
        }
    } catch(e) { tb.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--danger-color);">❌ 获取日志失败，请检查网络连接</td></tr>'; }
}

function filterAuditLogs() {
    const keyword = (document.getElementById('auditSearchInput').value || '').toLowerCase();
    // 🛡️ 修复：增加容错处理 (l.user || '')，防止数据库存在 NULL 字段导致 toLowerCase() 触发致命崩溃
    const filtered = currentAuditLogsData.filter(l => (l.user || '').toLowerCase().includes(keyword) || (l.action || '').toLowerCase().includes(keyword));
    drawAuditLogTable(filtered);
}

function exportAuditLogsCSV() {
    if(currentAuditLogsData.length === 0) return alert("⚠️ 当前没有可导出的日志数据！");
    // 添加 BOM 头 \uFEFF 防止 Excel 打开中文乱码
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF记录时间,操作人,动作记录\n";
    currentAuditLogsData.forEach(l => {
        const actionStr = l.action.replace(/"/g, '""'); // 处理双引号转义
        csvContent += `${l.time},${l.user},"${actionStr}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `审计日志备份_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addAuditLog('导出了全站审计日志 (CSV)');
    renderAuditLogs(); // 刷新一下把刚才自己导出的动作也显示出来
}

async function clearAuditLogs() {
    openConfirmModal(async () => {
        try {
            await fetch(`${API_BASE_URL}/admin/clear_logs`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key: currentUserKey}) });
            document.getElementById('auditSearchInput').value = '';
            addAuditLog('管理员高危操作：清空了系统审计日志');
            renderAuditLogs();
        } catch(e) { alert("清空失败"); }
    }, "🚨 危险操作：确定要永久清空所有成员的操作日志吗？此操作不可恢复！");
}

// ==================== 个人数据库全量备份与跨设备恢复引擎 ====================
async function exportLocalLibrary() {
    await initLocalDB(); const allAssets = await localDB.getAll();
    if (allAssets.length === 0) return alert("您的个人素材库是空的，无需备份！");
    
    const dataStr = JSON.stringify(allAssets);
    const estimatedSizeMB = (new Blob([dataStr]).size / (1024 * 1024)).toFixed(2);
    
    const confirmMsg = `当前图库共 <b>${allAssets.length}</b> 项素材，预计全量数据库备份约 <b>${estimatedSizeMB} MB</b>。<br><br><span style="color: var(--text-secondary); font-size: 0.9em; line-height: 1.5; display: block; text-align: left; background: var(--bg-hover); padding: 10px; border-radius: 8px;">💡 <b>温馨提示：</b><br>每次备份都会生成新文件，建议下载后及时清理旧备份，以免占用过多存储空间。</span><br>是否继续下载？`;
    
    openConfirmModal(() => {
        showToast("📦 正在生成全量数据库文件，请稍候...");
        const blob = new Blob([dataStr], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; 
        
        const timeStr = new Date().toLocaleTimeString('zh-CN', {hour12:false}).replace(/:/g, '');
        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `九雨本地数据库备份_${dateStr}_${timeStr}.json`;
        
        link.click(); URL.revokeObjectURL(url);
        showToast("✅ 数据库备份已完成！换电脑时可直接导入此文件恢复。");
    }, confirmMsg);
}

function triggerImportLocalLibrary() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0]; if(!file) return;
        processDatabaseFile(file);
    }; input.click();
}

function processDatabaseFile(file) {
    const reader = new FileReader();
    reader.onload = async ev => {
        try {
            const importedAssets = JSON.parse(ev.target.result);
            if (!Array.isArray(importedAssets)) throw new Error("无效格式");
            
            await initLocalDB();
            for(let asset of importedAssets) { await localDB.save(asset); } 
            
            showToast("✅ 数据库全量恢复成功！即将为您刷新界面...");
            setTimeout(() => location.reload(), 1500); 
        } catch(err) { alert("❌ 备份文件损坏或格式不正确！"); }
    }; reader.readAsText(file);
}
function handleLibraryDragOver(e) {
    e.preventDefault();
    const overlay = document.getElementById('libraryDragOverlay');
    if (overlay) overlay.style.display = 'flex';
}
function handleLibraryDragLeave(e) {
    e.preventDefault();
    const overlay = document.getElementById('libraryDragOverlay');
    // 如果鼠标离开的是父容器区域，才隐藏蒙层
    if (overlay && e.target === e.currentTarget) overlay.style.display = 'none';
}
function handleLibraryDrop(e) {
    e.preventDefault();
    const overlay = document.getElementById('libraryDragOverlay');
    if (overlay) overlay.style.display = 'none';
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.json')) {
            processDatabaseFile(file);
        } else {
            showToast("⚠️ 格式错误：请拖入 .json 格式的数据库备份文件！");
        }
    }
}
// =================================================================================

function renderAssetLibraryTool(mode) {
    currentLibraryMode = mode; const isPersonal = mode === 'personal';
    const titleText = isPersonal ? '🔒 我的个人专属素材库' : '📁 团队公共素材与角色库';
    const canUpload = isPersonal || isAdmin;

    let html = `
    <div class="hub-wrapper" ${isPersonal ? 'ondragover="handleLibraryDragOver(event)" ondragleave="handleLibraryDragLeave(event)" ondrop="handleLibraryDrop(event)" style="position: relative;"' : ''}>
        ${isPersonal ? '<div id="libraryDragOverlay" style="display: none; position: absolute; inset: 0; background: rgba(0, 122, 255, 0.1); border: 2px dashed var(--bg-user-msg); z-index: 100; border-radius: 12px; justify-content: center; align-items: center; font-size: 1.5rem; color: var(--bg-user-msg); font-weight: bold; backdrop-filter: blur(4px); pointer-events: none;">📥 松开鼠标，立即恢复数据库备份</div>' : ''}
        <div style="max-width: 1000px; margin: 0 auto; width: 100%; padding: 30px; box-sizing: border-box; animation: pop 0.3s ease;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 16px;">
                <div>
                    <h2 style="margin: 0 0 6px 0;">${titleText}</h2>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">
                        ${isPersonal ? '' : '由管理员维护的高质量基准素材，全员云端实时极速共享加载。'}
                    </div>
                </div>
                
                <div id="libraryHeaderBtns" style="display: ${isBulkMode ? 'none' : 'flex'}; gap:10px; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
                    `;
                    
                    if (isPersonal) {
                        html += `
                        <button onclick="exportLocalLibrary()" style="background: var(--bg-input); color: var(--text-main); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: 0.2s;" onmouseover="this.style.backgroundColor='var(--bg-hover)'" onmouseout="this.style.backgroundColor='var(--bg-input)'" title="打包下载到硬盘">📥 备份数据</button>
                        <button onclick="triggerImportLocalLibrary()" style="background: var(--bg-input); color: var(--text-main); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: 0.2s;" onmouseover="this.style.backgroundColor='var(--bg-hover)'" onmouseout="this.style.backgroundColor='var(--bg-input)'" title="从备份文件恢复">📤 恢复数据</button>
                        <div style="width: 1px; height: 20px; background: var(--border-color); margin: 0 5px;"></div>
                        `;
                    }

                    html += `<button onclick="toggleBulkMode()" style="background: var(--bg-input); color: var(--text-main); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 0.9rem; transition: 0.2s;" onmouseover="this.style.backgroundColor='var(--bg-hover)'" onmouseout="this.style.backgroundColor='var(--bg-input)'">☑️ 批量管理</button>`;
                    if (canUpload) { html += `<button id="uploadNewAssetBtn" onclick="document.getElementById('batchAssetUpload').click()" style="background: var(--bg-user-msg); color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.9rem; box-shadow: 0 2px 6px rgba(0,0,0,0.1); transition: 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">＋ 添加新素材</button>`; }
                    html += `
                </div>
            </div>

            ${isPersonal ? `
            <div id="personalWarningBanner" style="background: rgba(255, 149, 0, 0.1); border: 1px solid rgba(255, 149, 0, 0.3); border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; color: #ff9500; font-size: 0.9rem; animation: pop 0.3s ease;">
                <div>⚠️ <strong>安全提示：</strong> 数据仅存于当前浏览器，清理缓存或换电脑前请务必备份！</div>
                <button onclick="document.getElementById('personalWarningBanner').style.display='none'" style="background: transparent; border: none; color: #ff9500; font-size: 1.5rem; cursor: pointer; padding: 0 5px; line-height: 1; transition: 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" title="关闭提醒">×</button>
            </div>
            ` : ''}

            <div id="filterTabGroup" style="display: flex; gap: 10px; margin-bottom: 24px;">
                <button class="nav-btn ${currentAssetFilter === 'all' ? 'active' : ''}" data-filter="all" style="padding: 8px 16px; font-size: 0.9rem;" onclick="filterAssets('all')">全部展示</button>
                <button class="nav-btn ${currentAssetFilter === 'character' ? 'active' : ''}" data-filter="character" style="padding: 8px 16px; font-size: 0.9rem;" onclick="filterAssets('character')">👤 角色设定</button>
                <button class="nav-btn ${currentAssetFilter === 'scene' ? 'active' : ''}" data-filter="scene" style="padding: 8px 16px; font-size: 0.9rem;" onclick="filterAssets('scene')">🏞️ 场景概念</button>
            </div>
            <div id="assetGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;"></div>
        </div>
    </div>`;

    const toolbar = document.getElementById('bulkToolbar');
    if (toolbar) {
        if (isBulkMode) { 
            toolbar.style.display = 'flex'; 
            document.getElementById('bulkSelectCount').innerText = `已选择 ${selectedAssetIds.size} 项`; 
            const canManage = isPersonal || isAdmin; 
            document.getElementById('bulkCategoryBtn').style.display = canManage ? 'inline-block' : 'none'; 
            document.getElementById('bulkDeleteBtn').style.display = canManage ? 'inline-block' : 'none'; 
        } else { 
            toolbar.style.display = 'none'; 
        }
    }
    return html;
}

async function generateThumbnail(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX_DIM = 400; let w = img.width, h = img.height;
                if (w > MAX_DIM || h > MAX_DIM) { if (w > h) { h *= MAX_DIM / w; w = MAX_DIM; } else { w *= MAX_DIM / h; h = MAX_DIM; } }
                canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            }; img.src = e.target.result;
        }; reader.readAsDataURL(file);
    });
}

async function handleBatchAssetUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files); let upCount = 0; 
    const uploadBtn = document.getElementById('uploadNewAssetBtn'); if(uploadBtn) uploadBtn.disabled = true;
    for (let file of files) { 
        const thumbData = await generateThumbnail(file);
        const formData = new FormData(); formData.append('file', file); formData.append('title', file.name.substring(0, file.name.lastIndexOf('.')) || file.name); formData.append('type', 'character'); formData.append('library_mode', currentLibraryMode); formData.append('user_key', currentUserKey); formData.append('thumb_base64', thumbData);
        try {
            const res = await fetch(`${API_BASE_URL}/api/upload_asset`, { method: 'POST', body: formData });
            if(res.ok) {
                const d = await res.json();
                if(d.success) { d.asset.thumb = d.asset.image.replace(/(\.[^.]+)$/, '_thumb.jpg'); if (currentLibraryMode === 'team') teamAssets.unshift(d.asset); else personalAssets.unshift(d.asset); upCount++; }
            }
        } catch(e) {}
    }
    
    addAuditLog(`上传了 ${upCount} 张图片`); input.value = ''; if(uploadBtn) uploadBtn.disabled = false;
    showToast("上传成功"); renderAssetGrid();
}

function filterAssets(type) {
    currentAssetFilter = type;
    if(currentChatId === TEAM_ASSET_ID || currentChatId === PERSONAL_ASSET_ID) {
        // 💡 暴力清除：直接获取页面上所有作为过滤器的按钮，无差别移除高亮状态
        const allFilterBtns = document.querySelectorAll('button[data-filter]');
        allFilterBtns.forEach(btn => btn.classList.remove('active'));
        
        // 💡 精准点亮：只给当前点击的分类加上高亮状态
        const activeBtns = document.querySelectorAll(`button[data-filter="${type}"]`);
        activeBtns.forEach(btn => btn.classList.add('active'));
        
        renderAssetGrid();
    }
}

function drawTeamWatermark(canvas, ctx) {
    ctx.save(); ctx.font = "bold 32px sans-serif"; ctx.fillStyle = "rgba(255, 255, 255, 0.12)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.shadowColor = "rgba(0,0,0,0.2)"; ctx.shadowBlur = 2;
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-Math.PI / 6); ctx.translate(-canvas.width / 2, -canvas.height / 2);
    const diag = Math.sqrt(canvas.width*canvas.width + canvas.height*canvas.height);
    const startX = (canvas.width - diag) / 2; const endX = (canvas.width + diag) / 2; const startY = (canvas.height - diag) / 2; const endY = (canvas.height + diag) / 2;
    const stepX = 200; const stepY = 150; 
    for(let x = startX; x < endX; x += stepX) { for(let y = startY; y < endY; y += stepY) { const offsetX = (Math.abs(y / stepY) % 2 === 1) ? (stepX / 2) : 0; ctx.fillText("九雨团队", x + offsetX, y); } }
    ctx.restore();
}

function openFullImage(id) {
    if(isBulkMode) { toggleSelectAsset(id); return; } 
    const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets;
    const asset = sourceArray.find(a => a.id === id); if(!asset) return;
    const modal = document.getElementById('imageViewerModal'); const canvas = document.getElementById('fullViewCanvas'); const ctx = canvas.getContext('2d');
    const img = new Image(); img.crossOrigin = "Anonymous"; 
    img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0); if (currentLibraryMode === 'team') { drawTeamWatermark(canvas, ctx); } modal.classList.add('show'); };
    // 💡 修复：本地 Blob 数据无需加服务器 API 前缀
    img.src = asset.image.startsWith('data:') || asset.image.startsWith('blob:') || asset.image.startsWith('http') ? asset.image : API_BASE_URL + asset.image;
}
function closeImageViewer() { document.getElementById('imageViewerModal').classList.remove('show'); }

function renderAssetGrid() {
    const grid = document.getElementById('assetGrid'); if(!grid) return; grid.innerHTML = '';
    const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const filtered = currentAssetFilter === 'all' ? sourceArray : sourceArray.filter(a => a.type === currentAssetFilter);
    const canManage = (currentLibraryMode === 'personal') || isAdmin;
    if (filtered.length === 0) { grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary);">暂无相关素材，请点击右上角添加。</div>`; return; }

    filtered.forEach(asset => {
        const isSelected = selectedAssetIds.has(asset.id); let cardHtml = `<div class="asset-card ${isSelected ? 'selected' : ''}" id="asset-card-${escapeHTML(asset.id)}">`;
        cardHtml += `<div class="bulk-overlay" onclick="event.stopPropagation(); toggleSelectAsset('${asset.id}')" style="display: ${isBulkMode ? 'block' : 'none'};"></div><div class="checkbox-icon" style="display: ${isBulkMode ? 'flex' : 'none'};">✓</div>`;
       cardHtml += `<div class="canvas-container" title="点击查看大图" style="width: 100%; height: 240px; background: var(--bg-container); cursor: pointer; display: flex; justify-content: center; align-items: center;" onclick="openFullImage('${escapeHTML(asset.id)}')"><canvas id="canvas_${escapeHTML(asset.id)}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;"></canvas></div><div style="padding: 16px;"><div class="asset-title" style="font-weight: bold; margin-bottom: 6px; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(asset.title)}">${escapeHTML(asset.title)}</div><div class="asset-badge" style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; display: inline-block; background: var(--bg-container); padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border-color);">${asset.type === 'character' ? '👤 角色设定' : '🏞️ 场景概念'}</div><div style="display: flex; gap: 8px;"><button class="nav-btn" style="flex: 1; padding: 8px; font-size: 0.85rem; border-color: var(--shen-color); color: var(--shen-color);" data-img="${escapeHTML(asset.image)}" onclick="event.stopPropagation(); useAssetAsReference(this.getAttribute('data-img'))">🪄 垫图</button><button class="nav-btn" style="flex: 1; padding: 8px; font-size: 0.85rem;" data-prompt="${escapeHTML(asset.prompt||'')}" onclick="event.stopPropagation(); useAssetPrompt(this.getAttribute('data-prompt'))">♻️ 提词</button></div>`;
        if (canManage && !isBulkMode) { cardHtml += `<div style="display: flex; gap: 8px; margin-top: 8px;"><button class="nav-btn" style="flex: 1; padding: 6px; font-size: 0.85rem;" onclick="editAsset('${escapeHTML(asset.id)}')">✏️ 编辑</button><button class="nav-btn" style="flex: 1; padding: 6px; font-size: 0.85rem; border: none; color: var(--danger-color); background: transparent; opacity: 0.7;" onclick="deleteAsset('${escapeHTML(asset.id)}')" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">🗑️ 删除</button></div>`; }
        cardHtml += `</div></div>`; grid.innerHTML += cardHtml;
    });

    filtered.forEach(asset => {
        const canvas = document.getElementById(`canvas_${asset.id}`); if(!canvas) return;
        const ctx = canvas.getContext('2d'); const img = new Image(); img.crossOrigin = "Anonymous"; 
        img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0); if (currentLibraryMode === 'team') { drawTeamWatermark(canvas, ctx); } };
        // 💡 修复：确保正确的缩略图地址判定
        const imgSrc = asset.thumb || asset.image;
        img.src = imgSrc.startsWith('data:') || imgSrc.startsWith('blob:') || imgSrc.startsWith('http') ? imgSrc : API_BASE_URL + imgSrc;
    });
}

function toggleBulkMode() { 
    isBulkMode = !isBulkMode; 
    selectedAssetIds.clear(); 
    
    // ⚡ 柔和隐藏顶层按钮，避免 display: none 造成高度瞬间塌陷导致整个页面上跳
    const headerBtns = document.getElementById('libraryHeaderBtns');
    if (headerBtns) {
        if (isBulkMode) {
            headerBtns.style.opacity = '0';
            headerBtns.style.pointerEvents = 'none';
            setTimeout(() => headerBtns.style.display = 'none', 200);
        } else {
            headerBtns.style.display = 'flex';
            setTimeout(() => {
                headerBtns.style.opacity = '1';
                headerBtns.style.pointerEvents = 'auto';
            }, 10);
        }
    }

    const toolbar = document.getElementById('bulkToolbar');
    if (toolbar) {
        if (isBulkMode) { 
            toolbar.style.opacity = '0';
            toolbar.style.transform = 'translateY(10px)'; // 初始偏下一点点
            toolbar.style.display = 'flex'; 
            setTimeout(() => {
                toolbar.style.opacity = '1';
                toolbar.style.transform = 'translateY(0)'; // 平滑上浮对齐
            }, 10);
            
            document.getElementById('bulkSelectCount').innerText = `已选择 0 项`; 
            const canManage = currentLibraryMode === 'personal' || isAdmin; 
            document.getElementById('bulkCategoryBtn').style.display = canManage ? 'inline-block' : 'none'; 
            document.getElementById('bulkDeleteBtn').style.display = canManage ? 'inline-block' : 'none'; 
        } else { 
            toolbar.style.opacity = '0';
            toolbar.style.transform = 'translateY(10px)';
            setTimeout(() => toolbar.style.display = 'none', 200); 
        }
    }
    
    // ⚡ 极速无感切换蒙层
    document.querySelectorAll('.asset-card').forEach(card => card.classList.remove('selected'));
    document.querySelectorAll('.bulk-overlay').forEach(el => el.style.display = isBulkMode ? 'block' : 'none');
    document.querySelectorAll('.checkbox-icon').forEach(el => el.style.display = isBulkMode ? 'flex' : 'none');
}
function toggleSelectAsset(id) { 
    if (selectedAssetIds.has(id)) {
        selectedAssetIds.delete(id);
        const card = document.getElementById(`asset-card-${id}`);
        if(card) card.classList.remove('selected');
    } else { 
        selectedAssetIds.add(id);
        const card = document.getElementById(`asset-card-${id}`);
        if(card) card.classList.add('selected');
    } 
    document.getElementById('bulkSelectCount').innerText = `已选择 ${selectedAssetIds.size} 项`; 
}
function selectAllAssets() {
    const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets;
    const filtered = currentAssetFilter === 'all' ? sourceArray : sourceArray.filter(a => a.type === currentAssetFilter);
    if (filtered.length === 0) return;
    
    if (selectedAssetIds.size === filtered.length) { 
        selectedAssetIds.clear(); 
        filtered.forEach(asset => {
            const card = document.getElementById(`asset-card-${asset.id}`);
            if(card) card.classList.remove('selected');
        });
    } else { 
        filtered.forEach(asset => {
            selectedAssetIds.add(asset.id); 
            const card = document.getElementById(`asset-card-${asset.id}`);
            if(card) card.classList.add('selected');
        }); 
    }
    document.getElementById('bulkSelectCount').innerText = `已选择 ${selectedAssetIds.size} 项`;
}

async function executeBulkDownload() {
    if(selectedAssetIds.size === 0) return alert("请先选择要下载的素材！");
    showToast("正在后台下载真实文件为您打包，请稍候...");
    const zip = new JSZip(); const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; let count = 0; const promises = [];
    selectedAssetIds.forEach((id) => { 
        const asset = sourceArray.find(a => a.id === id); 
        if(asset && asset.image) { 
            count++; 
            // 💡 修复：兼容本地 Blob 和远程拉取的安全前缀
            const urlToFetch = asset.image.startsWith('data:') || asset.image.startsWith('blob:') || asset.image.startsWith('http') ? asset.image : API_BASE_URL + asset.image;
            const p = fetch(urlToFetch).then(res => res.blob()).then(blob => { let ext = asset.image.split('.').pop() || 'png'; if(ext.includes('blob')) ext = 'png'; zip.file(`${asset.title}_${count}.${ext}`, blob); }); 
            promises.push(p);
        } 
    });
    await Promise.all(promises); zip.generateAsync({type: "blob"}).then(content => { const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `素材批量下载_${Date.now()}.zip`; link.click(); addAuditLog(`批量下载了 ${count} 个素材`); toggleBulkMode(); });
}
function executeBulkDelete() {
    if(selectedAssetIds.size === 0) return alert("请先选择要删除的素材！");
    openConfirmModal(async () => {
        const idsToDelete = Array.from(selectedAssetIds);
        try {
            await fetch(`${API_BASE_URL}/api/delete_asset`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids: idsToDelete}) });
            if (currentLibraryMode === 'team') { teamAssets = teamAssets.filter(a => !selectedAssetIds.has(a.id)); } else { personalAssets = personalAssets.filter(a => !selectedAssetIds.has(a.id)); } addAuditLog(`批量删除了 ${idsToDelete.length} 个素材`); 
            
            // ⚡ 直接拔除 DOM 卡片，0 闪烁无缝过渡
            idsToDelete.forEach(id => { const card = document.getElementById(`asset-card-${id}`); if(card) card.remove(); });
        } catch(e) {}
        toggleBulkMode();
    });
}
function openBulkCategoryModal() { if(selectedAssetIds.size === 0) return alert("请先选择素材！"); document.getElementById('bulkCategoryModal').classList.add('show'); }
function closeBulkCategoryModal() { document.getElementById('bulkCategoryModal').classList.remove('show'); }
async function confirmBulkCategory() {
    const newType = document.getElementById('bulkCategorySelect').value; const idsToUpdate = Array.from(selectedAssetIds);
    try {
        await fetch(`${API_BASE_URL}/api/bulk_update_category`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids: idsToUpdate, type: newType}) });
        const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; sourceArray.forEach(asset => { if(selectedAssetIds.has(asset.id)) { asset.type = newType; } }); addAuditLog(`批量修改了 ${idsToUpdate.length} 个分类`); 
        
        // ⚡ 手术刀式更新，只修改文字或隐藏不符合当前过滤的卡片
        idsToUpdate.forEach(id => {
            const card = document.getElementById(`asset-card-${id}`);
            if(card) {
                if (currentAssetFilter !== 'all' && currentAssetFilter !== newType) { card.remove(); } 
                else { const badge = card.querySelector('.asset-badge'); if(badge) badge.innerText = newType === 'character' ? '👤 角色设定' : '🏞️ 场景概念'; }
            }
        });
    } catch(e) {}
    closeBulkCategoryModal(); toggleBulkMode();
}

function editAsset(id) { editingAssetId = id; const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === id); if(!asset) return; document.getElementById('editAssetTitle').value = asset.title; document.getElementById('editAssetType').value = asset.type; document.getElementById('editAssetPrompt').value = asset.prompt || ''; document.getElementById('editAssetModal').classList.add('show'); }
async function saveAssetEdit() { 
    const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === editingAssetId); if(!asset) return; 
    const newTitle = document.getElementById('editAssetTitle').value.trim(); const newType = document.getElementById('editAssetType').value; const newPrompt = document.getElementById('editAssetPrompt').value.trim(); 
    try { await fetch(`${API_BASE_URL}/api/update_asset`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: asset.id, title: newTitle, type: newType, prompt: newPrompt}) }); asset.title = newTitle; asset.type = newType; asset.prompt = newPrompt; 
        
        // ⚡ 手术刀式更新
        const card = document.getElementById(`asset-card-${editingAssetId}`);
        if(card) {
            if (currentAssetFilter !== 'all' && currentAssetFilter !== newType) { card.remove(); } 
            else { 
                const titleEl = card.querySelector('.asset-title'); if(titleEl) { titleEl.innerText = newTitle; titleEl.title = newTitle; }
                const badge = card.querySelector('.asset-badge'); if(badge) badge.innerText = newType === 'character' ? '👤 角色设定' : '🏞️ 场景概念'; 
            }
        }
    } catch(e) {}
    closeEditAssetModal(); 
}
function closeEditAssetModal() { document.getElementById('editAssetModal').classList.remove('show'); }
function deleteAsset(id) { 
    openConfirmModal(async () => { 
        try { await fetch(`${API_BASE_URL}/api/delete_asset`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids: [id]}) }); if (currentLibraryMode === 'team') { teamAssets = teamAssets.filter(a => a.id !== id); } else { personalAssets = personalAssets.filter(a => a.id !== id); } addAuditLog(`删除了素材`); 
        
            // ⚡ 同样直接移除卡片 DOM
            const card = document.getElementById(`asset-card-${id}`); if(card) card.remove();
        } catch(e) {}
    }); 
}
function useAssetInGen(assetId) { const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === assetId); if (!asset) return; extractAndGenerateImage(asset.prompt || '', API_BASE_URL + asset.image); }
function extractAndGenerateImage(promptText, referenceImage = null) {
    switchChat(IMAGE_GEN_ID); 
    if (referenceImage) { 
        currentUploadedImages = [referenceImage]; 
        renderUploadPreview();
    }
    document.getElementById('imgGenInput').value = promptText.replace(/[【】🎬]/g, '').trim(); 
}

window.handleSplitToolDragOver = function(e) { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--highlight-color)'; e.currentTarget.style.background = 'var(--bg-hover)'; };
window.handleSplitToolDragLeave = function(e) { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-input)'; };
window.handleSplitToolDrop = function(e) { 
    e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-input)'; 
    const files = e.dataTransfer.files; if (files && files.length > 0) { document.getElementById('splitUpload').files = files; window.updateSplitUploadLabel(document.getElementById('splitUpload')); } 
};
window.updateSplitUploadLabel = function(input) { 
    if(input.files && input.files.length > 0) { document.getElementById('splitUploadLabel').innerText = `✅ 已成功载入 ${input.files.length} 张图片！`; document.getElementById('splitUploadLabel').style.color = '#34c759'; } 
    else { document.getElementById('splitUploadLabel').innerText = '点击此处选择图片，或将图片拖拽到这里'; document.getElementById('splitUploadLabel').style.color = 'var(--text-main)'; } 
};
window.updateWmPreset = function() { const val = document.getElementById('wmPreset').value; document.getElementById('customWmCoords').style.display = (val === 'custom') ? 'flex' : 'none'; };

function renderImageSplitterTool() { return `<div class="hub-wrapper">
    <div style="max-width:850px; margin:0 auto; width:100%; padding:30px; background:var(--bg-container); border-radius:12px; border:1px solid var(--border-color); color:var(--text-main); box-sizing:border-box;">
        <h2 style="text-align:center; margin-top:0; margin-bottom:24px;">🧩 拆分与去水印实验室</h2>
        
        <div style="font-weight:600; margin-bottom:12px; color:var(--shen-color);">1. 拖拽批量上传图片</div>
        <label id="splitDropZone" ondragover="handleSplitToolDragOver(event)" ondragleave="handleSplitToolDragLeave(event)" ondrop="handleSplitToolDrop(event)" style="display:block; width:100%; padding:40px 20px; border:2px dashed var(--border-color); border-radius:10px; text-align:center; cursor:pointer; background:var(--bg-input); transition:all 0.2s; margin-bottom:24px; box-sizing:border-box;">
            <div style="font-size:2.5rem; margin-bottom:10px; opacity:0.8;">📥</div>
            <div id="splitUploadLabel" style="font-size:1.1rem; font-weight:bold; color:var(--text-main);">点击此处选择图片，或将图片直接拖拽到这里</div>
            <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">支持 JPG / PNG / WEBP 格式，可一次性多选</div>
            <input type="file" id="splitUpload" accept="image/jpeg, image/png, image/webp" multiple style="display:none;" onchange="updateSplitUploadLabel(this)">
        </label>

        <div style="display:flex; gap:20px; flex-wrap:wrap;">
            <div style="flex:1; min-width:300px; background:var(--bg-input); border:1px solid var(--border-color); padding:20px; border-radius:10px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div style="font-weight:bold; font-size:1.1rem; margin-bottom:15px; display:flex; align-items:center; gap:8px;">✂️ 多宫格拆分</div>
                    <div style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:15px; line-height:1.5;">将长图或多宫格漫画等分裁切为多张单图。</div>
                    <div style="display:flex; gap:15px; margin-bottom:20px; flex-wrap:wrap;">
                        <label style="display:flex; align-items:center; gap:8px;">行数 (横切): <input type="number" id="splitRows" value="2" min="1" style="width:60px; padding:8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"></label>
                        <label style="display:flex; align-items:center; gap:8px;">列数 (竖切): <input type="number" id="splitCols" value="2" min="1" style="width:60px; padding:8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"></label>
                    </div>
                </div>
                <button onclick="processToolImages('split')" style="background-color:var(--bg-user-msg); color:white; border:none; padding:14px; font-size:1rem; border-radius:8px; cursor:pointer; width:100%; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">⚡ 仅执行拆分并打包下载</button>
            </div>

            <div style="flex:1; min-width:300px; background:var(--bg-input); border:1px solid var(--border-color); padding:20px; border-radius:10px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div style="font-weight:bold; font-size:1.1rem; margin-bottom:15px; display:flex; align-items:center; gap:8px;">🌫️ 智能去水印</div>
                    <div style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:15px; line-height:1.5;">利用像素化算法或纯色块抹除图片角落的指定标识。</div>
                    
                    <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
                        <label style="display:flex; align-items:center; gap:5px;">位置: <select id="wmPreset" onchange="updateWmPreset()" style="padding:6px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"><option value="bottom-right">↘️ 右下角</option><option value="bottom-left">↙️ 左下角</option><option value="top-right">↗️ 右上角</option><option value="top-left">↖️ 左上角</option><option value="custom">⚙️ 自定义</option></select></label>
                        <label style="display:flex; align-items:center; gap:5px;">宽: <input type="number" id="wmW" value="240" style="width:50px; padding:6px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"></label>
                        <label style="display:flex; align-items:center; gap:5px;">高: <input type="number" id="wmH" value="80" style="width:50px; padding:6px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"></label>
                    </div>
                    <div id="customWmCoords" style="display:none; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
                        <label style="display:flex; align-items:center; gap:5px;">X坐标: <input type="number" id="wmX" value="0" style="width:60px; padding:6px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"></label>
                        <label style="display:flex; align-items:center; gap:5px;">Y坐标: <input type="number" id="wmY" value="0" style="width:60px; padding:6px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"></label>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center; margin-bottom:20px;">
                        <label style="display:flex; align-items:center; gap:5px;">方式: <select id="wmType" style="padding:6px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-container); color:var(--text-main);"><option value="mosaic">🌫️ 智能马赛克</option><option value="color">🎨 纯色块覆盖</option></select></label>
                        <label style="display:flex; align-items:center; gap:5px;">颜色: <input type="color" id="wmColor" value="#ffffff" style="border:none; border-radius:4px; cursor:pointer; background:transparent; padding:0; height:28px; width:30px;" title="仅在纯色覆盖时生效"></label>
                    </div>
                </div>
                <button onclick="processToolImages('watermark')" style="background-color:#34c759; color:white; border:none; padding:14px; font-size:1rem; border-radius:8px; cursor:pointer; width:100%; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">✨ 仅执行去水印并打包下载</button>
            </div>
        </div>
        <div id="splitStatus" style="margin-top:20px; font-size:1.05rem; color:var(--highlight-color); font-weight:bold; text-align:center;"></div>
    </div>
</div>`; }

async function processToolImages(mode) {
    const uploadInput = document.getElementById('splitUpload'); const statusDiv = document.getElementById('splitStatus'); const files = uploadInput.files;
    if (!files || files.length === 0) { showToast('⚠️ 请先点击或拖拽上传图片！'); return; }
    
    statusDiv.innerText = mode === 'split' ? '✂️ 正在执行裁切处理，请稍候...' : '🌫️ 正在执行去水印处理，请稍候...'; 
    const zip = new JSZip(); 
    
    const rows = parseInt(document.getElementById('splitRows').value) || 1;
    const cols = parseInt(document.getElementById('splitCols').value) || 1;
    
    const wmConfig = { preset: document.getElementById('wmPreset').value, type: document.getElementById('wmType').value, x: parseInt(document.getElementById('wmX').value) || 0, y: parseInt(document.getElementById('wmY').value) || 0, w: parseInt(document.getElementById('wmW').value) || 100, h: parseInt(document.getElementById('wmH').value) || 50, color: document.getElementById('wmColor').value };
    
    for (let i = 0; i < files.length; i++) {
        await new Promise((resolve) => {
            const img = new Image(); img.src = URL.createObjectURL(files[i]);
            img.onload = () => {
                const mainCanvas = document.createElement('canvas'); mainCanvas.width = img.width; mainCanvas.height = img.height; 
                const mainCtx = mainCanvas.getContext('2d'); mainCtx.drawImage(img, 0, 0);
                
                // 仅去水印模式执行擦除
                if (mode === 'watermark') { 
                    let finalX = wmConfig.x, finalY = wmConfig.y;
                    if (wmConfig.preset === 'bottom-right') { finalX = img.width - wmConfig.w; finalY = img.height - wmConfig.h; }
                    else if (wmConfig.preset === 'bottom-left') { finalX = 0; finalY = img.height - wmConfig.h; }
                    else if (wmConfig.preset === 'top-right') { finalX = img.width - wmConfig.w; finalY = 0; }
                    else if (wmConfig.preset === 'top-left') { finalX = 0; finalY = 0; }
                    
                    if (wmConfig.type === 'color') {
                        mainCtx.fillStyle = wmConfig.color; mainCtx.fillRect(finalX, finalY, wmConfig.w, wmConfig.h);
                    } else {
                        const mCanvas = document.createElement('canvas'); const mCtx = mCanvas.getContext('2d');
                        mCanvas.width = Math.max(1, Math.floor(wmConfig.w / 15)); mCanvas.height = Math.max(1, Math.floor(wmConfig.h / 15));
                        mCtx.drawImage(mainCanvas, finalX, finalY, wmConfig.w, wmConfig.h, 0, 0, mCanvas.width, mCanvas.height);
                        mainCtx.imageSmoothingEnabled = false; 
                        mainCtx.drawImage(mCanvas, 0, 0, mCanvas.width, mCanvas.height, finalX, finalY, wmConfig.w, wmConfig.h);
                        mainCtx.imageSmoothingEnabled = true; 
                    }
                }
                
                const originalName = files[i].name.substring(0, files[i].name.lastIndexOf('.')) || files[i].name;
                
                // 仅拆分模式执行裁切保存
                if (mode === 'split') {
                    const pieceWidth = img.width / cols, pieceHeight = img.height / rows;
                    for (let r = 0; r < rows; r++) { 
                        for (let c = 0; c < cols; c++) { 
                            const pieceCanvas = document.createElement('canvas'); pieceCanvas.width = pieceWidth; pieceCanvas.height = pieceHeight; 
                            const pieceCtx = pieceCanvas.getContext('2d'); 
                            pieceCtx.drawImage(mainCanvas, c * pieceWidth, r * pieceHeight, pieceWidth, pieceHeight, 0, 0, pieceWidth, pieceHeight); 
                            zip.file(`${originalName}_r${r+1}_c${c+1}.png`, pieceCanvas.toDataURL('image/png').replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, ""), { base64: true }); 
                        } 
                    } 
                } else {
                    // 去水印模式直接保存处理后的原图
                    zip.file(`${originalName}_clean.png`, mainCanvas.toDataURL('image/png').replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, ""), { base64: true });
                }
                resolve(); 
            }; img.onerror = () => resolve(); 
        });
    }
    zip.generateAsync({ type: 'blob' }).then(function(content) { 
        const link = document.createElement('a'); link.href = URL.createObjectURL(content); 
        link.download = mode === 'split' ? `AI拆分打包_${Date.now()}.zip` : `AI去水印打包_${Date.now()}.zip`; link.click(); 
        statusDiv.innerText = '✅ 处理与打包成功！'; 
        addAuditLog(mode === 'split' ? '使用了多宫格独立拆分工具' : '使用了独立去水印工具');
    });
}

function toggleImgGenSettings() { const panel = document.getElementById('imgGenSettingsPanel'); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }
function selectRatio(el, ratioText, width, height) { document.querySelectorAll('.ratio-btn').forEach(i => i.classList.remove('active')); el.classList.add('active'); currentSelectedRatioText = ratioText; document.getElementById('imgWidth').value = width; document.getElementById('imgHeight').value = height; const iconDiv = el.querySelector('.ratio-icon'); if (iconDiv) document.getElementById('toggleRatioIcon').className = iconDiv.className; document.getElementById('toggleRatioText').innerText = ratioText; }
function selectRes(el, cleanText) { document.querySelectorAll('.res-btn').forEach(i => i.classList.remove('active')); el.classList.add('active'); currentSelectedResText = cleanText; document.getElementById('toggleResText').innerText = cleanText; }

// 支持全局点击空白处收起尺寸设置面板
document.addEventListener('click', (e) => {
    const panel = document.getElementById('imgGenSettingsPanel'); const toggleBtn = document.getElementById('imgGenSettingsToggle');
    if (panel && panel.style.display === 'block') { if (!panel.contains(e.target) && !toggleBtn.contains(e.target)) { panel.style.display = 'none'; } }
});

// 动态高度自适应输入框
function autoResizeTextarea(el) { el.style.height = '36px'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }

// 拖拽上传引擎
function handleComposerDrop(e) { 
    const files = e.dataTransfer.files; 
    if(files && files.length > 0) { processImageFiles(files); } 
}
// 图片预览（支持点击看大图）与清除系统
function previewGenImage(input) { if (input.files && input.files.length > 0) { processImageFiles(input.files); input.value = ''; } }
function processImageFiles(files) {
    let validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (currentUploadedImages.length + validFiles.length > 10) {
        alert("⚠️ 最多只能上传 10 张图片作为参考！");
        validFiles = validFiles.slice(0, 10 - currentUploadedImages.length);
    }
    validFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            currentUploadedImages.push(e.target.result);
            renderUploadPreview();
        };
        reader.readAsDataURL(file);
    });
}
function renderUploadPreview() {
    const wrap = document.getElementById('imgUploadPreview');
    if (currentUploadedImages.length === 0) {
        wrap.style.display = 'none'; wrap.innerHTML = ''; return;
    }
    wrap.style.display = 'inline-flex'; wrap.style.flexWrap = 'wrap'; wrap.style.gap = '8px';
    wrap.innerHTML = ''; 
    currentUploadedImages.forEach((imgBase64, index) => {
        const div = document.createElement('div');
        div.className = 'img-preview-wrap';
        
        const img = document.createElement('img');
        img.src = imgBase64;
        img.className = 'img-preview-thumb';
        img.style.cursor = 'pointer';
        img.title = '点击放大查看';
        img.onclick = () => openFullImageFromBase64(imgBase64);
        
        const closeBtn = document.createElement('div');
        closeBtn.className = 'img-preview-close';
        closeBtn.innerText = '×';
        closeBtn.onclick = () => removeUploadedImage(index);
        
        div.appendChild(img);
        div.appendChild(closeBtn);
        wrap.appendChild(div);
    });
}
function removeUploadedImage(index) { currentUploadedImages.splice(index, 1); renderUploadPreview(); }
function clearGenImage() { currentUploadedImages = []; const u = document.getElementById('imgGenUpload'); if(u) u.value = ''; renderUploadPreview(); }
function clearComposer() { clearGenImage(); const input = document.getElementById('imgGenInput'); if(input) { input.value = ''; autoResizeTextarea(input); } }
function openFullImageFromBase64(base64Data) { const modal = document.getElementById('imageViewerModal'); const canvas = document.getElementById('fullViewCanvas'); const ctx = canvas.getContext('2d'); const img = new Image(); img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0); modal.classList.add('show'); }; img.src = base64Data; }

// 智能复用与重新生成引擎
function applyImageGenPrompt(msgIndex) {
    const chat = chats.find(c => c.id === IMAGE_GEN_ID); if(!chat || !chat.messages[msgIndex]) return;
    const msg = chat.messages[msgIndex];
    let promptText = msg.content; const promptMatch = promptText.match(/【提示词】\n(.*)/s) || promptText.match(/【提示词】(.*)/s);
    if (promptMatch && promptMatch[1]) {
        let extracted = promptMatch[1].trim();
        extracted = extracted.replace(/【强制底层约束.*?】/g, '').replace(/反向提示词：.*$/g, '').trim();
        document.getElementById('imgGenInput').value = extracted;
    } else { document.getElementById('imgGenInput').value = promptText; }
    
    currentUploadedImages = [];
    if(msg.attachedImages && msg.attachedImages.length > 0) {
        currentUploadedImages = [...msg.attachedImages];
    } else if(msg.attachedImage) {
        currentUploadedImages = [msg.attachedImage];
    }
    renderUploadPreview();
    
    const inputEl = document.getElementById('imgGenInput'); autoResizeTextarea(inputEl); inputEl.focus(); showToast("✅ 已成功抓取该轮参数至输入区");
}

function regenerateImage(msgIndex) {
    const chat = chats.find(c => c.id === IMAGE_GEN_ID); if(!chat) return;
    let userMsgIndex = -1; for(let i = msgIndex - 1; i >= 0; i--) { if(chat.messages[i].role === 'user') { userMsgIndex = i; break; } }
    if(userMsgIndex === -1) return alert("未找到该生成的历史指令！");
    applyImageGenPrompt(userMsgIndex); setTimeout(() => { sendImageGenMessage(); }, 200);
}

async function sendImageGenMessage() {
    let u = getUserUsage(currentUserKey);
    if (u.images >= u.limit) return alert(`您的生图额度已耗尽 (已用 ${u.images} / 额度 ${u.limit})，请联系管理员增加额度！`);

    const input = document.getElementById('userInput'); let msg = input.value.trim();
    if(!msg) { const altInput = document.getElementById('imgGenInput'); if(altInput) msg = altInput.value.trim(); }
    if(!msg && currentUploadedImages.length === 0) return;
    
    const chat = chats.find(c => c.id === IMAGE_GEN_ID) || chats.find(c => c.id === currentChatId); if(!chat) return;
    
    const w = document.getElementById('imgWidth').value; const h = document.getElementById('imgHeight').value;
    const sel = document.getElementById('imgGenModelSelect'); 
    const rawVal = sel.value; const modelText = sel.options[sel.selectedIndex].text;

    let apiSource = 'geeknow'; let modelId = rawVal;
    if(rawVal.includes(':::')) { const parts = rawVal.split(':::'); apiSource = parts[0]; modelId = parts[1]; } 
    else { apiSource = document.getElementById('apiSourceSelect') ? document.getElementById('apiSourceSelect').value : 'geeknow'; }

    const ratioMap = { "智能": "auto", "16:9": "16:9", "21:9": "21:9", "3:2": "3:2", "4:3": "4:3", "1:1": "1:1", "3:4": "3:4", "2:3": "2:3", "9:16": "9:16" };
    const apiRatio = ratioMap[currentSelectedRatioText] || "auto";
    const resMap = { "高清 2K": "2K", "超清 4K": "4K" };
    const apiSize = resMap[currentSelectedResText] || "1K";

    const systemConstraint = " 【强制底层约束：重新使用大模型生成，漫画或画面中的文本必须全部使用简体中文，不要有乱码，不要有繁体字】";
    const negativePrompt = "反向提示词：bad anatomy, traditional chinese characters, gibberish, messy text, garbled characters";

    let finalEngineeredPrompt = (msg || '（无提示词）') + systemConstraint + "\n" + negativePrompt;
    const payloadImages = [...currentUploadedImages];
    
    document.getElementById('imgGenSettingsPanel').style.display = 'none';
    chat.messages.push({ role: 'user', content: `【模型】${modelText}\n【尺寸设定】${currentSelectedRatioText} (${w}x${h}) | ${currentSelectedResText}\n【提示词】\n${finalEngineeredPrompt}`, attachedImages: payloadImages, timestamp: Date.now() });
    
    input.value = ''; clearComposer(); renderMessages();
    
    const botMsgIndex = chat.messages.length;
    // 💡 核心修复：打上 isHTML 标记，告诉渲染器这是进度条UI，绝对不要把它当成文字转义！
    chat.messages.push({ role: 'bot', content: '', timestamp: Date.now(), isThinking: false, isHTML: true }); 
    
    // 💡 植入高颜值动态进度条 UI
    chat.messages[botMsgIndex].content = `
        <div style="margin-top: 5px; padding: 12px; background: var(--bg-container); border: 1px solid var(--border-color); border-radius: 10px;">
            <div style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 10px; font-weight: bold; display: flex; justify-content: space-between;">
                <span id="gen-status-${botMsgIndex}">🚀 正在与云端引擎建立连接...</span>
                <span id="gen-percent-${botMsgIndex}" style="color: var(--shen-color);">0%</span>
            </div>
            <div style="width: 100%; height: 10px; background: var(--bg-input); border-radius: 5px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                <div id="gen-bar-${botMsgIndex}" style="width: 2%; height: 100%; background: linear-gradient(90deg, #00C6ff, #0072ff); transition: width 0.3s ease; border-radius: 5px;"></div>
            </div>
        </div>
    `;
    renderMessages();

    try {
        const res = await fetch(`${API_BASE_URL}/api/generate_image`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                password: currentUserKey, prompt: finalEngineeredPrompt, model: modelId, 
                size: `${w}x${h}`, aspectRatio: apiRatio, imageSize: apiSize, 
                api_source: apiSource, reference_images: payloadImages 
            })
        });

        // 💡 核心：流式解析器（像接收打字机一样接收进度）
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            
            let lines = buffer.split('\n');
            buffer = lines.pop(); // 保留不完整的截断数据
            
            for (let line of lines) {
                if (line.startsWith('data:')) {
                    let dataStr = line.substring(5).trim();
                    if (!dataStr || dataStr === '[DONE]') continue;
                    try {
                        let d = JSON.parse(dataStr);
                        
                        // 遇到报错，立刻终止
                        if (d.error) {
                            chat.messages[botMsgIndex].isHTML = false;
                            chat.messages[botMsgIndex].content = "❌ 绘制失败: \n" + d.error;
                            renderMessages();
                            return; 
                        }
                        
                        // 更新进度条
                        if (d.progress !== undefined) {
                            const bar = document.getElementById(`gen-bar-${botMsgIndex}`);
                            const percent = document.getElementById(`gen-percent-${botMsgIndex}`);
                            const status = document.getElementById(`gen-status-${botMsgIndex}`);
                            if(bar) bar.style.width = Math.max(2, d.progress) + '%';
                            if(percent) percent.innerText = d.progress + '%';
                            if(status) status.innerText = '⏳ 正在努力渲染画面细节...';
                        }
                        
                        // 生成成功！提取图片并展示
                        if ((d.status === 'succeeded' || d.status === 'SUCCESS') && d.results) {
                            let imgUrls = d.results.map(r => r.url || r.imageUrl).filter(Boolean);
                            if (imgUrls.length > 0) {
                                incrementUsage(currentUserKey);
                                addAuditLog(`调用 ${modelText} 生成了图片`);
                                chat.messages[botMsgIndex].isHTML = false; // 渲染完毕后收回特权
                                chat.messages[botMsgIndex].content = '✨ 绘制完成：';
                                chat.messages[botMsgIndex].type = 'image_gallery';
                                chat.messages[botMsgIndex].images = imgUrls;
                                renderMessages();
                                return;
                            }
                        } else if (d.status === 'failed' || d.status === 'FAIL') {
                            chat.messages[botMsgIndex].isHTML = false;
                            chat.messages[botMsgIndex].content = "❌ 绘制失败: \n" + (d.failure_reason || d.failReason || "云端异常拦截");
                            renderMessages();
                            return;
                        }
                    } catch(e) { console.log("进度解析忽略的小错误", e); }
                }
            }
        }
        
        // 如果数据流走完还没拿到图片（极端情况防卡死）
        if (chat.messages[botMsgIndex].type !== 'image_gallery') {
            chat.messages[botMsgIndex].isHTML = false;
            chat.messages[botMsgIndex].content = "❌ 数据流已结束，但未能获取到图片。";
            renderMessages();
        }

    } catch(e) { 
        chat.messages[botMsgIndex].isHTML = false;
        chat.messages[botMsgIndex].content = "❌ 网络连接中断！请检查您的网络或后端服务。"; 
        renderMessages();
    }
}


async function downloadSingleImage(imgUrl, index) { 
    try {
        // 1. 如果是本地的 Base64 数据，直接触发下载
        if (imgUrl.startsWith('data:')) {
            const link = document.createElement('a'); link.href = imgUrl; link.download = `Img_${index+1}.png`; link.click();
            return;
        }
        
        // 2. 如果是云端 HTTP 链接，强制 Fetch 拉取到本地内存后下载，彻底杜绝跳转新标签页！
        showToast("⏳ 正在拉取原图，即将开始下载...");
        const res = await fetch(imgUrl);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a'); 
        link.href = blobUrl; 
        link.download = `AI_Image_${Date.now()}_${index+1}.png`; // 加上时间戳防止重名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl); // 释放内存
    } catch(e) {
        // 兜底方案：如果遇到了极其严格的跨域限制拉取失败，再降级为新标签页打开
        const link = document.createElement('a'); link.href = imgUrl; link.target = '_blank'; link.download = `Img_${index+1}.png`; link.click();
    }
}

async function downloadGalleryZip(msgIndex) {
    const chat = chats.find(c => c.id === IMAGE_GEN_ID), msg = chat.messages[msgIndex]; if(!msg || !msg.images) return;
    showToast("📦 正在拉取所有原图并打包 ZIP，请稍候...");
    const zip = new JSZip(); 
    
    // 异步拉取所有图片转化为可打包的二进制数据
    const promises = msg.images.map(async (imgUrl, i) => {
        try {
            if(imgUrl.startsWith('data:')) {
                zip.file(`Img_${i+1}.png`, imgUrl.split(',')[1], { base64: true });
            } else {
                const res = await fetch(imgUrl);
                const blob = await res.blob();
                zip.file(`Img_${i+1}.png`, blob);
            }
        } catch(e) { console.error("ZIP打包拉取失败", e); }
    });
    
    await Promise.all(promises);
    zip.generateAsync({ type: 'blob' }).then(content => { 
        const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `AI_Gallery_${Date.now()}.zip`; link.click(); 
        addAuditLog('打包下载了生成的画廊'); 
        showToast("✅ ZIP 打包下载完成！"); 
    });
}

function renderHubContent() {
    return `
    <div class="hub-wrapper">
        <div class="desktop-hub-container">
            <div class="hub-icon-big">🎬</div>
            <div class="hub-title">剧本转分镜 (九雨)</div>
            <button class="hub-new-btn" onclick="createNewStoryboard()">＋ 新建分镜项目</button>
            <div class="hub-recent-section">
                <div class="hub-list-title">近期对话</div>
                ${chats.filter(c => c.isStoryboard).length === 0 ? '<div style="text-align:center; color: var(--text-secondary); padding: 30px;">暂无分镜项目</div>' : chats.filter(c => c.isStoryboard).sort((a,b) => b.id - a.id).slice(0,5).map(c => `
                    <div class="hub-item" onclick="switchChat('${c.id}')"><div class="hub-item-icon">🎬</div><div class="hub-item-title" title="${c.title}">${c.title}</div><div class="hub-item-actions"><button onclick="openRenameModal('${c.id}', event)">✏️ 重命名</button><button onclick="deleteChat('${c.id}', event)">🗑️ 删除</button></div></div>
                `).join('')}
            </div>
        </div>

        <div class="mobile-hub-container">
            <div class="hub-greeting">
                <span class="hub-greeting-name">${escapeHTML(currentUserName)}，你好</span>
                <span class="hub-greeting-ask">需要我为你做些什么？</span>
            </div>
            <div class="hub-chips-container">
                <button class="hub-chip" onclick="switchChat(IMAGE_GEN_ID)">🖼️ 制作图片</button>
                <button class="hub-chip" onclick="createNewStoryboard()">🎬 剧本分镜</button>
                <button class="hub-chip" onclick="switchChat(TEAM_ASSET_ID)">📁 团队素材</button>
                <button class="hub-chip" onclick="switchChat(PERSONAL_ASSET_ID)">🔒 个人素材</button>
                <button class="hub-chip" onclick="createNewChat()">💬 新建闲聊</button>
                <button class="hub-chip" onclick="switchChat(IMAGE_SPLIT_ID)">🧩 拆分图片</button>
            </div>
        </div>
    </div>`;
}

function switchChat(id) { 
    if (currentChatId === id && currentChatId !== null) return;
    isBulkMode = false; selectedAssetIds.clear(); currentChatId = id; 
    const inputSec = document.getElementById('inputSection'), imgGenSec = document.getElementById('imageGenInputSection'), chatBox = document.getElementById('chatBox'), title = document.getElementById('headerTitle'), backBtn = document.getElementById('backToHubBtn'), editIcon = document.getElementById('headerEditIcon'), input = document.getElementById('userInput');
    const exportBtn = document.getElementById('exportPdfBtn'); 
    
    inputSec.style.display = 'none'; imgGenSec.style.display = 'none'; backBtn.style.display = 'none'; editIcon.style.display = 'none'; exportBtn.style.display = 'none';
    if(document.getElementById('imgGenSettingsPanel')) document.getElementById('imgGenSettingsPanel').style.display = 'none';
    
    if (id === HUB_ID) { title.innerText = "九雨创作台"; chatBox.innerHTML = renderHubContent(); } 
    else if (id === TEAM_ASSET_ID) { title.innerText = "📁 团队公共素材库"; chatBox.innerHTML = renderAssetLibraryTool('team'); renderAssetGrid(); } 
    else if (id === PERSONAL_ASSET_ID) { 
        title.innerText = "🔒 我的个人素材库"; 
        chatBox.innerHTML = renderAssetLibraryTool('personal'); 
        renderAssetGrid(); 
    }
    else if (id === IMAGE_SPLIT_ID) { title.innerText = "批量图片拆分与去水印工具"; chatBox.innerHTML = renderImageSplitterTool(); } 
    else if (id === IMAGE_GEN_ID) { title.innerText = "🎨 AI生图控制台"; imgGenSec.style.display = 'flex'; renderMessages(); } 
    else {
        const c = chats.find(x => x.id === id); title.innerText = c.title; editIcon.style.display = 'inline-block'; inputSec.style.display = 'flex'; exportBtn.style.display = 'inline-block'; 
        if (c.isStoryboard) { backBtn.style.display = 'inline-block'; input.placeholder = "请输入您的剧本......"; } else { input.placeholder = "问问 Gemini 3..."; }
        input.value = ''; renderMessages(); 
    }
    
    renderSidebar(); 
    if (window.innerWidth <= 768 && !isSidebarCollapsed) { toggleSidebar(); }
}

function renderSidebar() {
    const list = document.getElementById('chatList'); list.innerHTML = '';
    let display = currentTab === 'fav' ? chats.filter(c => c.isFavorite && !c.isStoryboard && !c.isImageGen) : chats.filter(c => !c.isStoryboard && !c.isImageGen); 
    
    document.getElementById('storyboardBtn').classList.toggle('active', currentChatId === HUB_ID || (chats.find(c=>c.id===currentChatId)?.isStoryboard === true));
    document.getElementById('imageGenBtn').classList.toggle('active', currentChatId === IMAGE_GEN_ID);
    document.getElementById('teamAssetBtn').classList.toggle('active', currentChatId === TEAM_ASSET_ID);
    document.getElementById('personalAssetBtn').classList.toggle('active', currentChatId === PERSONAL_ASSET_ID);
    document.getElementById('imageSplitBtn').classList.toggle('active', currentChatId === IMAGE_SPLIT_ID);
    
    display.sort((a,b) => {
        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
        if (a.isPinned) return (a.pinnedAt || 0) - (b.pinnedAt || 0); 
        return b.id - a.id; 
    }).forEach(c => {
        const div = document.createElement('div'); div.className = `chat-item ${c.id === currentChatId ? 'active' : ''}`; div.onclick = () => switchChat(c.id);
        const d = new Date(parseInt(c.id)); 
        const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
        const h = String(d.getHours()).padStart(2,'0'), min = String(d.getMinutes()).padStart(2,'0');
        const timeStr = `${y}-${mo}-${day} ${h}:${min}`;

        div.innerHTML = `
            <div style="display:flex; flex-direction:column; flex:1; overflow:hidden;">
                <span class="chat-title" title="${escapeHTML(c.title)}">${c.isPinned?'📌 ':''}💬 ${escapeHTML(c.title)}</span>
                <span style="font-size:0.7rem; color:var(--text-secondary); opacity:0.6; margin-top:2px;">${timeStr}</span>
            </div>
            <div class="chat-actions">
                <button class="action-btn" onclick="togglePin('${c.id}', event)">📍</button>
                <button class="action-btn" onclick="toggleFav('${c.id}', event)">${c.isFavorite?'🌟':'⭐'}</button>
                <button class="action-btn" onclick="openRenameModal('${c.id}', event)">✏️</button>
                <button class="action-btn" onclick="deleteChat('${c.id}', event)">🗑️</button>
            </div>`;
        list.appendChild(div);
    });
}

function formatText(text) {
    if(!text) return '';
    // 安全优化：强化了 Markdown 解析器，全方位覆盖 HTML 特殊转义字符
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); 
    const codeBlocks = [];
    html = html.replace(/```([\s\S]*?)```/g, function(match, code) { codeBlocks.push(code); return `___CODE_BLOCK_${codeBlocks.length - 1}___`; });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); html = html.replace(/\n/g, '<br>'); 
    html = html.replace(/___CODE_BLOCK_(\d+)___/g, function(match, i) { return `<pre><code>${codeBlocks[i]}</code></pre>`; });
    return html;
}

function renderMessages() {
    if([HUB_ID, IMAGE_SPLIT_ID, TEAM_ASSET_ID, PERSONAL_ASSET_ID].includes(currentChatId)) return;
    const box = document.getElementById('chatBox'); box.innerHTML = '';
    const chat = chats.find(c => c.id === currentChatId); if(!chat) return;
    
    chat.messages.forEach((m, index) => {
        const wrapper = document.createElement('div'); wrapper.style.display = 'flex'; wrapper.style.flexDirection = 'column'; wrapper.style.alignItems = m.role === 'user' ? 'flex-end' : 'flex-start'; wrapper.style.width = '100%';
        const timeDiv = document.createElement('div'); timeDiv.style.fontSize = '0.75rem'; timeDiv.style.color = 'var(--text-secondary)'; timeDiv.style.opacity = '0.6'; timeDiv.style.marginBottom = '6px'; timeDiv.style.padding = '0 8px';
        const d = new Date(m.timestamp || parseInt(chat.id) || Date.now()); const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0'); const h = String(d.getHours()).padStart(2,'0'), min = String(d.getMinutes()).padStart(2,'0');
        timeDiv.innerText = `${y}-${mo}-${day} ${h}:${min}`;

        const div = document.createElement('div'); div.className = `message ${m.role === 'user' ? 'user-msg' : 'bot-msg'}`; div.style.alignSelf = 'auto';
        const contentWrapper = document.createElement('div'); contentWrapper.className = 'text-content-wrapper';
        
        const isLongText = (m.content && m.content.length > 200) || false;
        if (m.role === 'user' && isLongText) { contentWrapper.classList.add('text-collapsed'); }

        const contentDiv = document.createElement('div'); contentDiv.className = 'msg-content'; contentDiv.id = `msg-content-${index}`; 
        if (m.isThinking) { contentDiv.innerHTML = `<div style="display: flex; align-items: center; gap: 5px; padding: 10px 0; pointer-events: none;"><div class="loader" style="margin: -35px -25px -35px -35px;"><svg width="100" height="100" viewBox="0 0 100 100"><defs><mask id="clipping"><polygon points="0,0 100,0 100,100 0,100" fill="black"></polygon><polygon points="25,25 75,25 50,75" fill="white"></polygon><polygon points="50,25 75,75 25,75" fill="white"></polygon><polygon points="35,35 65,35 50,65" fill="white"></polygon><polygon points="35,35 65,35 50,65" fill="white"></polygon><polygon points="35,35 65,35 50,65" fill="white"></polygon><polygon points="35,35 65,35 50,65" fill="white"></polygon></mask></defs></svg><div class="box"></div></div><span style="color: var(--text-secondary); font-size: 0.95rem; font-weight: 500;">正在思考...</span></div>`; }
        else if (m.isHTML) { contentDiv.innerHTML = m.content; } 
        else { contentDiv.innerHTML = formatText(m.content); }
        
        contentWrapper.appendChild(contentDiv);
        
        if (m.role === 'user') {
            const imgs = m.attachedImages || (m.attachedImage ? [m.attachedImage] : []);
            if (imgs.length > 0) {
                const imgWrap = document.createElement('div'); imgWrap.style.marginTop = '10px'; imgWrap.style.display = 'flex'; imgWrap.style.flexWrap = 'wrap'; imgWrap.style.gap = '8px';
                imgs.forEach(imgSrc => {
                    const imgEl = document.createElement('img');
                    imgEl.src = imgSrc;
                    imgEl.style.cssText = "max-width: 120px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.3); cursor:pointer;";
                    imgEl.onclick = () => openFullImageFromBase64(imgSrc);
                    imgWrap.appendChild(imgEl);
                });
                contentWrapper.appendChild(imgWrap);
            }
        }
       if (m.type === 'image_gallery' && m.images) {
            const galleryDiv = document.createElement('div'); 
            galleryDiv.style.cssText = "display: flex; gap: 15px; background: var(--bg-container); padding: 15px; border-radius: 12px; border: 1px solid var(--border-color); margin-top: 10px; width: 100%; box-sizing: border-box;";
            
            // 左侧大图焦点区域
            const mainArea = document.createElement('div');
            mainArea.style.cssText = "flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 0;";
            
            const mainImg = document.createElement('img');
            mainImg.id = `focus-main-${index}`;
            mainImg.src = m.images[0];
            mainImg.title = "点击查看安全无码大图";
            mainImg.style.cssText = "width: 100%; border-radius: 8px; object-fit: contain; max-height: 550px; cursor: pointer; transition: opacity 0.2s ease-in-out; background: var(--bg-input); border: 1px solid var(--border-color); box-shadow: 0 2px 10px rgba(0,0,0,0.05);";
            mainImg.onclick = () => openFullImageFromBase64(mainImg.src);
            
            // 底部高级控制操作面板
            const controls = document.createElement('div');
            controls.style.cssText = "display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;";
            controls.innerHTML = `
                <button style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); cursor: pointer; font-weight: 500; transition: all 0.2s; white-space: nowrap;" onmouseover="this.style.backgroundColor='var(--bg-hover)'" onmouseout="this.style.backgroundColor='var(--bg-input)'" onclick="saveToPersonalLibrary(document.getElementById('focus-main-${index}').src, ${index})">💾 保存至素材库</button>
                <button style="flex: 1.5; padding: 10px; border-radius: 8px; border: none; background: linear-gradient(135deg, #00C6ff, #0072ff); color: white; cursor: pointer; font-weight: bold; box-shadow: 0 4px 12px rgba(0, 114, 255, 0.25); white-space: nowrap; transition: all 0.2s;" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 16px rgba(0, 114, 255, 0.4)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 12px rgba(0, 114, 255, 0.25)';" onclick="downloadSingleImage(document.getElementById('focus-main-${index}').src, 0)">⬇️ 下载当前原图</button>
                <button style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); cursor: pointer; font-weight: 500; transition: all 0.2s; white-space: nowrap;" onmouseover="this.style.backgroundColor='var(--bg-hover)'" onmouseout="this.style.backgroundColor='var(--bg-input)'" onclick="downloadGalleryZip(${index})">📦 打包全部 (ZIP)</button>
            `;
            
            mainArea.appendChild(mainImg);
            mainArea.appendChild(controls);
            galleryDiv.appendChild(mainArea);

            // 右侧缩略图轨道（只有在生成了多张图时才会出现）
            if (m.images.length > 1) {
                const strip = document.createElement('div');
                strip.style.cssText = "width: 80px; display: flex; flex-direction: column; gap: 8px; max-height: 600px; overflow-y: auto; padding-right: 4px;";
                
                m.images.forEach((imgBase64, imgIndex) => {
                    const thumb = document.createElement('img');
                    thumb.src = imgBase64;
                    thumb.className = `focus-thumb-${index}`;
                    thumb.title = `查看第 ${imgIndex + 1} 张`;
                    // 第一张图默认激活
                    thumb.style.cssText = `width: 100%; height: 80px; object-fit: cover; border-radius: 6px; cursor: pointer; transition: all 0.2s; border: 2px solid ${imgIndex === 0 ? '#0072ff' : 'transparent'}; opacity: ${imgIndex === 0 ? '1' : '0.5'}; box-sizing: border-box;`;
                    
                    // 悬停动画
                    thumb.onmouseover = () => { if (thumb.style.borderColor === 'transparent') thumb.style.opacity = '0.8'; };
                    thumb.onmouseout = () => { if (thumb.style.borderColor === 'transparent') thumb.style.opacity = '0.5'; };
                    
                    // 点击切换大图动效
                    thumb.onclick = () => {
                        mainImg.style.opacity = '0.3'; // 大图渐出
                        setTimeout(() => {
                            mainImg.src = imgBase64; // 替换数据
                            mainImg.style.opacity = '1'; // 大图渐入
                        }, 150);
                        
                        // 还原所有小图状态
                        document.querySelectorAll(`.focus-thumb-${index}`).forEach(t => {
                            t.style.borderColor = 'transparent';
                            t.style.opacity = '0.5';
                        });
                        // 点亮当前选中的小图
                        thumb.style.borderColor = '#0072ff';
                        thumb.style.opacity = '1';
                    };
                    strip.appendChild(thumb);
                });
                galleryDiv.appendChild(strip);
            }
            
            contentWrapper.appendChild(galleryDiv);
        }
        
        const actionBar = document.createElement('div'); actionBar.className = 'msg-actions';

        if ((isLongText || m.role === 'bot') && !m.isThinking) {
            const toggleBtn = document.createElement('button'); toggleBtn.className = 'msg-action-btn'; toggleBtn.innerHTML = (m.role === 'user' && isLongText) ? '🔽 展开' : '🔼 收起';
            if (m.role === 'bot' && m.content.length < 100) toggleBtn.style.display = 'none';
            toggleBtn.onclick = () => { const isNowCollapsed = contentWrapper.classList.toggle('text-collapsed'); toggleBtn.innerHTML = isNowCollapsed ? '🔽 展开' : '🔼 收起'; };
            actionBar.appendChild(toggleBtn);
        }

        if (chat.isStoryboard && m.role === 'bot' && !m.isThinking) {
            const extractBtn = document.createElement('button'); extractBtn.className = 'msg-action-btn'; extractBtn.innerHTML = '🎨 一键发往生图'; extractBtn.onclick = () => extractAndGenerateImage(m.content); actionBar.appendChild(extractBtn);
        }
        if (currentChatId === IMAGE_GEN_ID && !m.isThinking) {
            if (m.role === 'user') {
                const applyBtn = document.createElement('button'); applyBtn.className = 'msg-action-btn'; applyBtn.innerHTML = '♻️ 复用参数'; applyBtn.onclick = () => applyImageGenPrompt(index); actionBar.appendChild(applyBtn);
            } else if (m.role === 'bot' && m.type === 'image_gallery') {
                const regenBtn = document.createElement('button'); regenBtn.className = 'msg-action-btn'; regenBtn.innerHTML = '🔄 重新生成'; regenBtn.onclick = () => regenerateImage(index); actionBar.appendChild(regenBtn);
            }
        }
        if (m.type === 'image_gallery') { const zipBtn = document.createElement('button'); zipBtn.className = 'msg-action-btn'; zipBtn.innerHTML = '📦 打包ZIP'; zipBtn.onclick = () => downloadGalleryZip(index); actionBar.appendChild(zipBtn); }
        if (!m.isThinking) { const copyBtn = document.createElement('button'); copyBtn.className = 'msg-action-btn'; copyBtn.innerHTML = '📋 复制'; copyBtn.onclick = () => copyToClipboard(m.content); actionBar.appendChild(copyBtn); }
        if (currentChatId !== IMAGE_GEN_ID && !m.isThinking) { const delBtn = document.createElement('button'); delBtn.className = 'msg-action-btn delete-action'; delBtn.innerHTML = '🗑️ 删除'; delBtn.onclick = () => { openConfirmModal(() => { chat.messages.splice(index, 1); saveChats(); renderMessages(); }); }; actionBar.appendChild(delBtn); }
        
        div.appendChild(contentWrapper); div.appendChild(actionBar); wrapper.appendChild(timeDiv); wrapper.appendChild(div); box.appendChild(wrapper);
    });
    box.scrollTop = box.scrollHeight;
}

function exportToPDF() {
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat || chat.messages.length === 0) return alert("无可导出内容。");
    let printHTML = `<h1 style="text-align: center;">${chat.title}</h1><hr style="margin-bottom: 20px;">`;
    chat.messages.forEach((m) => {
        printHTML += `<div class="print-msg"><div class="print-role">${m.role === 'user' ? '🎬 剧本/输入' : '🎥 分镜描述/AI回复'}</div><div class="print-content">${formatText(m.content)}</div>`;
        if (m.attachedImage) printHTML += `<img src="${m.attachedImage}" class="print-img">`;
        if (m.type === 'image_gallery' && m.images) { printHTML += `<div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">`; m.images.forEach(img => printHTML += `<img src="${img}" class="print-img" style="max-width: 200px;">`); printHTML += `</div>`; }
        printHTML += `</div>`;
    });
    document.getElementById('printArea').innerHTML = printHTML; addAuditLog('导出了 PDF'); window.print();
}

function createNewChat() { const id = Date.now().toString(); chats.unshift({id, title:"💬 新闲聊", messages:[], isPinned:false, isFavorite:false, isStoryboard:false}); saveChats(); switchChat(id); }
function createNewStoryboard() { const id = Date.now().toString(); chats.unshift({id, title:"未命名分镜项目", messages:[], isPinned:false, isFavorite:false, isStoryboard:true}); saveChats(); switchChat(id); addAuditLog('新建了分镜项目');}
function saveChats() { if(currentUserKey) { localStorage.setItem('chats_' + currentUserKey, JSON.stringify(chats)); syncChatsToCloud(); } }
function togglePin(id, e) { e.stopPropagation(); const c = chats.find(x=>x.id===id); c.isPinned = !c.isPinned; if(c.isPinned) { c.pinnedAt = Date.now(); } else { delete c.pinnedAt; } saveChats(); renderSidebar(); }
function toggleFav(id, e) { e.stopPropagation(); const c = chats.find(x=>x.id===id); c.isFavorite = !c.isFavorite; saveChats(); renderSidebar(); }
function switchTab(t) { currentTab = t; document.getElementById('tab-all').classList.toggle('active', t==='all'); document.getElementById('tab-fav').classList.toggle('active', t==='fav'); renderSidebar(); }
function deleteChat(id, e) { e.stopPropagation(); openConfirmModal(() => { chats = chats.filter(x=>x.id!==id); saveChats(); if(currentChatId === HUB_ID || currentChatId === id) { switchChat(HUB_ID); } else { renderSidebar(); } }); }
function renameCurrentChat() { if (![HUB_ID, IMAGE_GEN_ID, IMAGE_SPLIT_ID, TEAM_ASSET_ID, PERSONAL_ASSET_ID].includes(currentChatId)) { openRenameModal(currentChatId, new Event('click')); } }
function openRenameModal(id, e) { e.stopPropagation(); renamingChatId = id; document.getElementById('renameInput').value = chats.find(c => c.id === id).title; document.getElementById('renameModal').classList.add('show'); }
function closeRenameModal() { document.getElementById('renameModal').classList.remove('show'); }
function confirmRename() { const v = document.getElementById('renameInput').value.trim(); if(v) { const c = chats.find(x=>x.id===renamingChatId); c.title = v; if(renamingChatId===currentChatId) document.getElementById('headerTitle').innerText=v; saveChats(); if(currentChatId === HUB_ID) document.getElementById('chatBox').innerHTML = renderHubContent(); else renderSidebar(); } closeRenameModal(); }
function toggleTheme() { document.body.classList.toggle('dark-theme'); }

async function sendMessage() {
    if(!currentUserKey) return;
    const k = currentUserKey; const apiSource = document.getElementById('apiSourceSelect').value; const modelType = document.getElementById('modelSelect').value; const input = document.getElementById('userInput'); const msg = input.value.trim(); const chat = chats.find(c => c.id === currentChatId);
    if(!msg || !chat || !modelType) return; 
    
    chat.messages.push({ role:'user', content:msg, timestamp: Date.now() });
    if(chat.title.includes("新") || chat.title.includes("未命名")) { chat.title = msg.substring(0,12); document.getElementById('headerTitle').innerText = chat.title; }
    input.value = ''; input.style.height = '60px'; input.classList.remove('show-scrollbar');
    const botMsgIndex = chat.messages.length; chat.messages.push({ role:'bot', content:'', timestamp: Date.now(), isThinking: true }); renderMessages();
    
    try {
        const res = await fetch(`${API_BASE_URL}/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ password: k, message: msg, history: chat.messages.slice(0, -2).filter(m => !m.isThinking), api_source: apiSource, model_type: modelType, is_storyboard: !!chat.isStoryboard }) });
        chat.messages[botMsgIndex].isThinking = false;

        if (!res.ok) { const d = await res.json().catch(()=>({})); chat.messages[botMsgIndex].content = d.error || "网络连接失败，状态码: " + res.status; saveChats(); renderMessages(); return; }

        const reader = res.body.getReader(); const decoder = new TextDecoder('utf-8'); let done = false; let buffer = '';
        let targetContent = ""; let displayedContent = ""; let isAnimating = false; let typeInterval = null;

        function startSmoothTyping() {
            if (isAnimating) return;
            isAnimating = true;
            typeInterval = setInterval(() => {
                let diff = targetContent.length - displayedContent.length;
                if (diff > 0) {
                    let step = 1; if (diff > 20) step = 2; if (diff > 60) step = 3; if (diff > 120) step = 5;
                    displayedContent += targetContent.substr(displayedContent.length, step); chat.messages[botMsgIndex].content = displayedContent;
                    if (currentChatId === chat.id) { const div = document.getElementById(`msg-content-${botMsgIndex}`); if (div) { div.innerHTML = formatText(displayedContent) + '<span style="color: var(--text-secondary);"> ▋</span>'; const box = document.getElementById('chatBox'); box.scrollTop = box.scrollHeight; } }
                } else if (done) {
                    clearInterval(typeInterval); isAnimating = false;
                    if (currentChatId === chat.id) { const div = document.getElementById(`msg-content-${botMsgIndex}`); if (div) div.innerHTML = formatText(targetContent); }
                    saveChats(); renderSidebar();
                }
            }, 30); 
        }

        while (!done) {
            const { value, done: readerDone } = await reader.read(); done = readerDone;
            if (value) {
                buffer += decoder.decode(value, { stream: true }); let lines = buffer.split('\n'); buffer = lines.pop(); 
                for (let line of lines) {
                    if (line.trim()) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.reply) { targetContent += parsed.reply; startSmoothTyping(); } 
                            else if (parsed.error) { targetContent += "\n[报错]: " + parsed.error; startSmoothTyping(); }
                        } catch (e) {}
                    }
                }
            }
        }
        
        if (!isAnimating && done) { chat.messages[botMsgIndex].content = targetContent; if (currentChatId === chat.id) { const div = document.getElementById(`msg-content-${botMsgIndex}`); if (div) div.innerHTML = formatText(chat.messages[botMsgIndex].content); } saveChats(); renderSidebar(); }

    } catch(e) { chat.messages[botMsgIndex].isThinking = false; chat.messages[botMsgIndex].content = "网络连接失败，请重试~"; saveChats(); renderMessages(); }
}

// ================== 生态双向连通引擎 ==================

// 1. 生图入库：将生成的图片及参数存入个人素材库
async function saveToPersonalLibrary(base64Data, msgIndex) {
    const chat = chats.find(c => c.id === currentChatId); if (!chat) return;
    
    // 向上追溯，提取生成该图时的提示词
    let promptText = "无提示词";
    for(let i = msgIndex - 1; i >= 0; i--) {
        if(chat.messages[i].role === 'user') {
            const m = chat.messages[i].content.match(/【提示词】\n(.*)/s) || chat.messages[i].content.match(/【提示词】(.*)/s);
            if (m && m[1]) promptText = m[1].replace(/【强制底层约束.*?】/g, '').replace(/反向提示词：.*$/g, '').trim();
            else promptText = chat.messages[i].content;
            break;
        }
    }
    
    try {
        showToast("⏳ 正在保存至个人素材库...");
        const res = await fetch(base64Data); const blob = await res.blob();
        const file = new File([blob], `gen_${Date.now()}.png`, { type: 'image/png' });
        
        const formData = new FormData();
        formData.append('file', file); 
        formData.append('title', `AI生图_${new Date().toLocaleTimeString('zh-CN', {hour12:false})}`);
        formData.append('type', 'image'); 
        formData.append('prompt', promptText); 
        formData.append('library_mode', 'personal'); 
        formData.append('user_key', currentUserKey);
        
        const uploadRes = await fetch(`${API_BASE_URL}/api/upload_asset`, { method: 'POST', body: formData });
        const data = await uploadRes.json();
        
        if (data.success) { 
            showToast("✅ 已成功存入您的个人素材库！"); 
            addAuditLog('将生图结果快捷入库至个人素材库'); 
        } else { 
            alert("保存失败: " + (data.error || "未知原因")); 
        }
    } catch (e) { alert("保存错误，请检查网络连接。"); }
}

// 2. 资产出库：将素材库的图片提取为控制台垫图
function useAssetAsReference(imgUrl) {
    switchChat(IMAGE_GEN_ID);
    const fullUrl = imgUrl.startsWith('http') ? imgUrl : (API_BASE_URL + imgUrl);
    if(currentUploadedImages.length >= 10) return alert("⚠️ 控制台垫图已达 10 张上限！");
    
    currentUploadedImages.push(fullUrl);
    renderUploadPreview();
    showToast("✅ 已提取素材作为垫图");
}

// 3. 资产出库：提取素材库的提示词填入控制台
function useAssetPrompt(promptText) {
    if(!promptText || promptText === 'undefined') return showToast("⚠️ 该素材没有附带提示词");
    switchChat(IMAGE_GEN_ID);
    const inputEl = document.getElementById('imgGenInput');
    inputEl.value = promptText;
    if(typeof autoResizeTextarea === 'function') autoResizeTextarea(inputEl);
    inputEl.focus();
    showToast("✅ 已成功提取提示词参数");
}

init();
// =========================================================================
// 🚀 终极权限与游客模式引擎 (直接追加到底部，自动覆盖全局生效)
// =========================================================================

// 1. 全局 UI 鉴权拦截器 (没登入直接弹窗提示)
function checkAuth() {
    if (!currentUserKey) {
        showToast("⚠️ 游客模式仅供预览，请先验证密钥登入以解锁此功能！");
        const ks = document.getElementById('keySection');
        if (ks) ks.style.display = 'flex';
        const sk = document.getElementById('secretKey');
        if(sk) sk.focus();
        return false;
    }
    return true;
}

// 2. 动态劫持所有核心功能按钮 (没登入绝对点不了)
const _oldCreateNewChat = window.createNewChat || createNewChat;
window.createNewChat = function() { if(checkAuth()) _oldCreateNewChat(); };

const _oldCreateNewStoryboard = window.createNewStoryboard || createNewStoryboard;
window.createNewStoryboard = function() { if(checkAuth()) _oldCreateNewStoryboard(); };

const _oldSendMessage = window.sendMessage || sendMessage;
window.sendMessage = async function() { if(checkAuth()) await _oldSendMessage(); };

const _oldSendImageGenMessage = window.sendImageGenMessage || sendImageGenMessage;
window.sendImageGenMessage = async function() { if(checkAuth()) await _oldSendImageGenMessage(); };

const _oldHandleBatchAssetUpload = window.handleBatchAssetUpload || handleBatchAssetUpload;
window.handleBatchAssetUpload = async function(input) { if(checkAuth()) await _oldHandleBatchAssetUpload(input); else input.value=''; };

const _oldProcessToolImages = window.processToolImages || processToolImages;
window.processToolImages = async function(mode) { if(checkAuth()) await _oldProcessToolImages(mode); };

const _oldExecuteBulkDownload = window.executeBulkDownload || executeBulkDownload;
window.executeBulkDownload = async function() { if(checkAuth()) await _oldExecuteBulkDownload(); };

const _oldExportToPDF = window.exportToPDF || exportToPDF;
window.exportToPDF = function() { if(checkAuth()) _oldExportToPDF(); };

// 3. 拦截进入个人私密库
const _oldSwitchChat = window.switchChat || switchChat;
window.switchChat = function(id) {
    if (id === PERSONAL_ASSET_ID && !checkAuth()) { _oldSwitchChat(HUB_ID); return; }
    _oldSwitchChat(id);
};

// ========================== 统一拦截引擎开始 =================================

// 🔥 核心提速黑科技：将庞大的 Base64 实时转换为轻量级 Blob URL
function base64ToBlobUrl(base64) {
    if (!base64 || typeof base64 !== 'string' || !base64.startsWith('data:')) return base64;
    try {
        const parts = base64.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while(n--){ u8arr[n] = bstr.charCodeAt(n); }
        return URL.createObjectURL(new Blob([u8arr], {type:mime}));
    } catch(e) { return base64; }
}

// 🔥 替换原有的弱伪随机数生成
function generateSecureToken() {
    const array = new Uint32Array(2);
    crypto.getRandomValues(array);
    return array[0].toString(36) + array[1].toString(36) + Date.now().toString(36);
}

// 🛡️ 终极网络请求拦截引擎 (集成本地数据库、自动鉴权、安全熔断于一体)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const url = args[0]; const options = args[1] || {};

    // 1. 本地数据库无感拦截 (个人素材库)
    if (typeof url === 'string' && options.body) {
        try {
            if (url.includes('/api/get_assets')) {
                const bodyObj = JSON.parse(options.body);
                if (bodyObj.library_mode === 'personal') {
                    await initLocalDB(); const localAssets = await localDB.getAll();
                    const fastAssets = localAssets.map(a => ({ ...a, image: base64ToBlobUrl(a.image), thumb: base64ToBlobUrl(a.thumb) }));
                    return new Response(JSON.stringify(fastAssets), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
            }
            if (url.includes('/api/upload_asset') && options.body instanceof FormData && options.body.get('library_mode') === 'personal') {
                await initLocalDB();
                const file = options.body.get('file');
                const unique_id = 'local_asset_' + generateSecureToken();
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = async () => {
                        const assetObj = {
                            id: unique_id, title: options.body.get('title') || '未命名', type: options.body.get('type') || 'character',
                            prompt: options.body.get('prompt') || '', image: reader.result, thumb: options.body.get('thumb_base64') || reader.result,
                            library_mode: 'personal', created_at: Date.now()
                        };
                        await localDB.save(assetObj);
                        resolve(new Response(JSON.stringify({ success: true, asset: assetObj }), { status: 200 }));
                    };
                    if (file) reader.readAsDataURL(file); else resolve(new Response(JSON.stringify({ error: "No file" }), { status: 400 }));
                });
            }
            if (url.includes('/api/delete_asset') || url.includes('/api/update_asset') || url.includes('/api/bulk_update_category')) {
                const bodyObj = JSON.parse(options.body);
                const targetIds = bodyObj.ids || (bodyObj.id ? [bodyObj.id] : []);
                if (targetIds.length > 0 && targetIds[0].startsWith('local_asset_')) {
                    await initLocalDB();
                    if (url.includes('delete')) await localDB.delete(targetIds);
                    if (url.includes('update_asset')) {
                        const tx = localDBInstance.transaction('assets', 'readwrite'); const store = tx.objectStore('assets');
                        const getReq = store.get(bodyObj.id);
                        getReq.onsuccess = () => { if(getReq.result) { let item = getReq.result; item.title = bodyObj.title; item.type = bodyObj.type; item.prompt = bodyObj.prompt; store.put(item); } };
                    }
                    if (url.includes('bulk_update')) {
                         const tx = localDBInstance.transaction('assets', 'readwrite'); const store = tx.objectStore('assets');
                         targetIds.forEach(id => { const getReq = store.get(id); getReq.onsuccess = () => { if(getReq.result) { let item = getReq.result; item.type = bodyObj.type; store.put(item); } } });
                    }
                    return new Response(JSON.stringify({success:true}), { status: 200 });
                }
            }
        } catch(e) {
            console.error("本地数据库拦截器异常:", e);
        }
    }

    // 2. 自动注入安全密钥 (对所有API请求生效)
    if (typeof url === 'string' && (url.includes('/api/') || url.includes('/admin/') || url.includes('/chat'))) {
        if (options.method === 'POST') {
            if (options.body && typeof options.body === 'string') {
                try {
                    let bodyObj = JSON.parse(options.body);
                    if (typeof currentUserKey !== 'undefined' && currentUserKey && !bodyObj.user_key && !bodyObj.password && !bodyObj.admin_key) {
                        bodyObj.user_key = currentUserKey; 
                        bodyObj.password = currentUserKey; // 兼容旧API
                        options.body = JSON.stringify(bodyObj);
                    }
                } catch(e) { /* 忽略非JSON体 */ }
            } else if (options.body instanceof FormData) {
                if (typeof currentUserKey !== 'undefined' && currentUserKey && !options.body.has('user_key')) { options.body.append('user_key', currentUserKey); }
            }
        }
    }

    // 3. 发起真实请求并设置安全熔断
    const response = await originalFetch.apply(this, args);
    if (response && (response.status === 401 || response.status === 403)) {
        console.warn("🚨 触发高危预警：请求被后端安全盾拦截！");
        if (typeof forceLogout === 'function') {
            forceLogout("🚨 安全警告：系统检测到您的请求存在越权行为或凭证已失效，为保护数据安全，已强制熔断连接！");
        }
    }
    return response;
};

// 4. 修复退出登录变白板，清理旧版冗余，合并精简登出逻辑
forceLogout = function(alertMsg) {
    if(heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    currentUserKey = null; currentSessionToken = null;
    
    // 🛡️ 极度安全修复：彻底抹除浏览器本地私有密钥指纹！防止恶意用户通过 F5 刷新绕过拦截进行重连
    localStorage.removeItem('user_secret_key');
    localStorage.removeItem('last_used_key');
    
    // 🛡️ 物理隔离：强制清空内存中的所有私有聊天和素材数据！
    chats = []; 
    personalAssets = [];
    currentUploadedImages = [];
    
    document.getElementById('keySection').style.display = 'flex'; 
    document.getElementById('headerActions').style.display = 'none'; 
    document.getElementById('chatList').innerHTML = ''; 
    _oldSwitchChat(HUB_ID); 
    
    // 🛡️ 强制重绘一次大厅，确保残影被彻底清除
    const chatBox = document.getElementById('chatBox');
    if (currentChatId === HUB_ID && chatBox) chatBox.innerHTML = renderHubContent();

    if(alertMsg) showToast(alertMsg);
    if (window.innerWidth <= 768) { 
        isSidebarCollapsed = true; 
        document.getElementById('appSidebar')?.classList.add('collapsed'); 
        document.getElementById('mobileOverlay')?.classList.remove('show'); 
    }
};
// ======= 输入框动态高度与滚动边界逻辑 =======
const chatInputBox = document.getElementById('userInput');
if (chatInputBox) {
    chatInputBox.addEventListener('input', function() {
        // 使用 auto 才能平滑计算真实高度，彻底告别闪烁跳动
        this.style.height = 'auto'; 
        const newHeight = this.scrollHeight;
        
        if (newHeight <= 60) {
            this.style.height = '60px';
            this.classList.remove('show-scrollbar');
        } else if (newHeight >= 300) {
            this.style.height = '300px';
            this.classList.add('show-scrollbar');
        } else {
            this.style.height = newHeight + 'px';
            this.classList.remove('show-scrollbar');
        }
    });
}

// 给发送按钮增加点击后输入框回缩逻辑
const realSendBtn = document.querySelector('.desktop-send');
if (realSendBtn) {
    realSendBtn.addEventListener('click', () => {
        if (chatInputBox) {
            setTimeout(() => {
                chatInputBox.style.height = '60px';
                chatInputBox.classList.remove('show-scrollbar');
            }, 50);
        }
    });
}
// 重启一次引擎，应用最高权限
setTimeout(() => { init(); }, 50);
// ========================== 统一拦截引擎结束 ========================================
