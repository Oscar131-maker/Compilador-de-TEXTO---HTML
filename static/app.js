document.addEventListener('DOMContentLoaded', () => {
    // Check Auth first
    const token = localStorage.getItem('auth_token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // --- DOM Elements ---
    const templateListEl = document.getElementById('template-list');
    const templateNameEl = document.getElementById('template-name');
    const htmlContentEl = document.getElementById('html-content');
    const textInputEl = document.getElementById('text-input');
    const btnNew = document.getElementById('btn-new-template');
    const btnSave = document.getElementById('btn-save');
    const btnDelete = document.getElementById('btn-delete');
    const btnGenerate = document.getElementById('btn-generate');

    // Result Modal
    const modalEl = document.getElementById('result-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const resultOutputEl = document.getElementById('result-output');
    const replacementsCountEl = document.getElementById('replacements-count');
    const btnCopy = document.getElementById('btn-copy');
    const btnDownload = document.getElementById('btn-download');

    // Confirm Modal
    const confirmModalEl = document.getElementById('confirm-modal');
    const confirmMessageEl = document.getElementById('confirm-message');
    const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
    const btnConfirmYes = document.getElementById('btn-confirm-yes');
    const btnCloseConfirm = document.querySelector('.js-close-confirm');

    // Toasts
    const toastContainer = document.getElementById('toast-container');

    // --- State ---
    let templates = [];
    let currentTemplateId = null;
    let confirmCallback = null;

    // --- Helpers: Auth Headers ---
    function getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    function checkAuthError(res) {
        if (res.status === 401) {
            localStorage.removeItem('auth_token');
            window.location.href = '/login.html';
            return true;
        }
        return false;
    }

    // --- Helpers: Toast & Confirm ---

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '⚠️';

        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span class="toast-message">${message}</span>
        `;

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }

    function showConfirm(message, callback) {
        confirmMessageEl.textContent = message;
        confirmCallback = callback;
        confirmModalEl.classList.remove('hidden');
    }

    function hideConfirm() {
        confirmModalEl.classList.add('hidden');
        confirmCallback = null;
    }

    // --- API Calls ---

    async function fetchTemplates() {
        try {
            const res = await fetch('/api/templates', { headers: getHeaders() });
            if (checkAuthError(res)) return;

            if (res.ok) {
                templates = await res.json();
                renderSidebar();
            } else {
                showToast('Failed to load templates', 'error');
            }
        } catch (err) {
            console.error('Error fetching templates:', err);
            showToast('Connection error', 'error');
        }
    }

    async function saveTemplate() {
        const name = templateNameEl.value.trim();
        const content = htmlContentEl.value;

        if (!name) {
            showToast('Please enter a template name.', 'error');
            return;
        }

        const payload = JSON.stringify({ name, content });
        try {
            let res;
            if (currentTemplateId) {
                // Update
                res = await fetch(`/api/templates/${currentTemplateId}`, {
                    method: 'PUT',
                    headers: getHeaders(),
                    body: payload
                });
            } else {
                // Create
                res = await fetch('/api/templates', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: payload
                });
            }

            if (checkAuthError(res)) return;

            if (res.ok) {
                const updatedTemplate = await res.json();
                if (!currentTemplateId) currentTemplateId = updatedTemplate.id;

                await fetchTemplates();
                selectTemplate(currentTemplateId);
                showToast('Template saved successfully.', 'success');
            } else {
                showToast('Error saving template.', 'error');
            }
        } catch (err) {
            console.error('Error saving:', err);
            showToast('Network error while saving.', 'error');
        }
    }

    async function deleteTemplate() {
        if (!currentTemplateId) return;

        showConfirm('Are you sure? This cannot be undone.', async () => {
            try {
                const res = await fetch(`/api/templates/${currentTemplateId}`, {
                    method: 'DELETE',
                    headers: getHeaders()
                });

                if (checkAuthError(res)) return;

                if (res.ok) {
                    currentTemplateId = null;
                    resetEditor();
                    await fetchTemplates();
                    showToast('Template deleted.', 'success');
                } else {
                    showToast('Error deleting template.', 'error');
                }
            } catch (err) {
                showToast('Network error while deleting.', 'error');
            }
        });
    }

    async function generateHTML() {
        const htmlTemplate = htmlContentEl.value;
        const inputText = textInputEl.value;

        if (!htmlTemplate || !inputText) {
            showToast('Missing HTML or Text Content.', 'error');
            return;
        }

        try {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    template_content: htmlTemplate,
                    input_text: inputText
                })
            });

            if (checkAuthError(res)) return;

            if (res.ok) {
                const data = await res.json();
                showResult(data.generated_html, data.replacements_count);
                showToast('Verification successful', 'success');
            } else {
                showToast('Error generating HTML.', 'error');
            }

        } catch (err) {
            showToast('Error processing request.', 'error');
        }
    }

    // --- UI/Event Handlers (Same as before) ---
    function renderSidebar() {
        templateListEl.innerHTML = '';
        templates.forEach(t => {
            const div = document.createElement('div');
            div.className = `template-item ${t.id === currentTemplateId ? 'active' : ''}`;
            div.textContent = t.name;
            div.onclick = () => selectTemplate(t.id);
            templateListEl.appendChild(div);
        });
    }

    function selectTemplate(id) {
        const template = templates.find(t => t.id === id);
        if (!template) return;
        currentTemplateId = id;
        renderSidebar();
        templateNameEl.value = template.name;
        htmlContentEl.value = template.content;
        btnDelete.classList.remove('hidden');
    }

    function resetEditor() {
        currentTemplateId = null;
        templateNameEl.value = '';
        htmlContentEl.value = '';
        renderSidebar();
        btnDelete.classList.add('hidden');
    }

    function showResult(html, count) {
        resultOutputEl.value = html;
        replacementsCountEl.textContent = `${count} placeholder(s) replaced.`;
        modalEl.classList.remove('hidden');
    }

    // Events
    btnNew.addEventListener('click', resetEditor);
    btnSave.addEventListener('click', saveTemplate);
    btnDelete.addEventListener('click', deleteTemplate);
    btnGenerate.addEventListener('click', generateHTML);

    btnConfirmCancel.addEventListener('click', hideConfirm);
    btnCloseConfirm.addEventListener('click', hideConfirm);
    btnConfirmYes.addEventListener('click', () => { if (confirmCallback) confirmCallback(); hideConfirm(); });

    btnCloseModal.addEventListener('click', () => modalEl.classList.add('hidden'));

    btnCopy.addEventListener('click', () => {
        resultOutputEl.select();
        document.execCommand('copy');
        showToast('Copied to clipboard!', 'success');
    });

    btnDownload.addEventListener('click', () => {
        const html = resultOutputEl.value;
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const name = templateNameEl.value.trim() || 'generated_page';
        a.download = name.includes('.html') ? name : `${name}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Logout Helper (Optional UI, but logic is here)
    // const btnLogout = document.getElementById('btn-logout');
    // if(btnLogout) btnLogout.addEventListener('click', () => { localStorage.removeItem('auth_token'); window.location.href='/login.html'; });

    // Initial Load
    fetchTemplates();
});
