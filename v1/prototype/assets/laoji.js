(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const navigateTo = (target, options) => {
    if (window.LaojiNavigation?.go) return window.LaojiNavigation.go(target, options);
    if (options?.replace) window.location.replace(target);
    else window.location.assign(target);
    return target;
  };
  const storageMemory = new Map();
  const safeStorage = {
    getItem(key) {
      try {
        const value = window.localStorage.getItem(key);
        if (value !== null) storageMemory.set(key, value);
        return value;
      } catch (_) {
        return storageMemory.has(key) ? storageMemory.get(key) : null;
      }
    },
    setItem(key, value) {
      const normalized = String(value);
      storageMemory.set(key, normalized);
      try { window.localStorage.setItem(key, normalized); }
      catch (_) { /* Keep interactions usable inside restricted preview frames. */ }
    },
    removeItem(key) {
      storageMemory.delete(key);
      try { window.localStorage.removeItem(key); }
      catch (_) { /* Keep interactions usable inside restricted preview frames. */ }
    }
  };

  function showToast(message) {
    let toast = $("#global-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "global-toast";
      toast.className = "toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  const PROFILE_KEY = 'laoji-profile';
  const DEFAULT_AVATAR = 'assets/laoji-default-avatar.png';
  const DEFAULT_PROFILE = { name: '老己用户', email: 'you@example.com', avatar: '' };
  const EMAIL_VERIFICATION_CODE = '123456';
  const SETTINGS_RETURN_ALLOWLIST = new Set([
    'laoji-settings.html',
    'laoji-library.html',
    'laoji-chat.html',
    'laoji-wechat-book.html',
    'laoji-pdf-reader.html',
    'laoji-epub-reader.html',
    'laoji-ppt-materials.html',
    'laoji-ppt-outline.html',
    'laoji-ppt-preview.html'
  ]);

  function resolveSettingsReturnTarget(value, fallback = 'laoji-settings.html') {
    return SETTINGS_RETURN_ALLOWLIST.has(value || '') ? value : fallback;
  }

  function resolveAvatar(value) {
    if (typeof value !== 'string' || !value.trim()) return DEFAULT_AVATAR;
    const source = value.trim();
    if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(source)) return source;
    if (/^(?:\.\/)?assets\/[\w./-]+$/i.test(source)) return source.replace(/^\.\//, '');
    return DEFAULT_AVATAR;
  }

  function readProfile() {
    try {
      const stored = JSON.parse(safeStorage.getItem(PROFILE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return { ...DEFAULT_PROFILE };
      return {
        name: typeof stored.name === 'string' && stored.name.trim() ? stored.name.trim() : DEFAULT_PROFILE.name,
        email: typeof stored.email === 'string' ? stored.email.trim() : DEFAULT_PROFILE.email,
        avatar: typeof stored.avatar === 'string' ? stored.avatar : ''
      };
    } catch (_) {
      return { ...DEFAULT_PROFILE };
    }
  }

  function applyProfile(profile = readProfile()) {
    const avatar = resolveAvatar(profile.avatar);
    $$('[data-user-avatar]').forEach((image) => {
      image.src = avatar;
      image.alt = `${profile.name}的头像`;
      image.addEventListener('error', () => { image.src = DEFAULT_AVATAR; }, { once: true });
    });
    $$('[data-user-name]').forEach((node) => { node.textContent = profile.name; });
    $$('[data-profile-email-value]').forEach((node) => { node.textContent = profile.email || DEFAULT_PROFILE.email; });
  }

  function connectionLabel(state) {
    return ['connected', 'syncing'].includes(state) ? '已连接' : ['invalid', 'limited', 'partial'].includes(state) ? '需重新连接' : state === 'validating' ? '正在连接' : '未配置';
  }

  function applyConnectionStatus(nodes, state) {
    const active = ['connected', 'syncing'].includes(state);
    const error = ['invalid', 'limited', 'partial'].includes(state);
    nodes.forEach((status) => {
      status.textContent = connectionLabel(state);
      status.dataset.state = active ? 'active' : error ? 'error' : '';
      status.classList.toggle('is-active', active);
    });
  }

  function applyAiStatusLinks(nodes, state) {
    const active = ['connected', 'syncing'].includes(state);
    const needsReconnect = ['invalid', 'limited', 'partial'].includes(state);
    applyConnectionStatus(nodes, state);
    nodes.forEach((link) => {
      link.textContent = active ? 'AI 已连接' : needsReconnect ? 'AI 需重新连接' : 'AI 未配置 · 去配置';
    });
  }

  function applySetupReturnLinks(returnTo, root = document) {
    $$('[data-setup-cancel]', root).forEach((link) => link.setAttribute('href', returnTo));
  }

  function initSettingsDetailPage() {
    if (!document.body.matches('.settings-detail-page[data-settings-page]')) return;
    const params = new URLSearchParams(window.location.search);
    const returnTo = resolveSettingsReturnTarget(params.get('return'));
    $$('[data-settings-detail-back]').forEach((link) => link.setAttribute('href', returnTo));
    applySetupReturnLinks(returnTo);
  }

  function bindConnectionRevoke(dialog, kind, onRevoke) {
    const confirm = $('[data-connection-revoke-confirm]', dialog);
    if (!confirm) return false;
    confirm.addEventListener('click', () => {
      onRevoke(kind === 'ai' ? 'unconfigured' : 'disconnected');
      dialog.close();
    });
    return true;
  }

  function initProfileSettings() {
    const form = $('[data-profile-form]');
    if (!form) return;
    let profile = readProfile();
    const name = $('#profile-name', form);
    const preview = $('[data-profile-avatar-preview]');
    const input = $('[data-avatar-input]');
    const avatarError = $('[data-avatar-error]');
    const nameError = $('[data-profile-name-error]');
    const nameSave = $('[data-profile-name-save]', form);
    const avatarReset = $('[data-avatar-reset]');
    const saveStates = $$('[data-profile-save-state]');
    let pendingAvatar = profile.avatar;

    const setSaveState = (value = '') => saveStates.forEach((node) => { node.textContent = value; });
    const syncNameSave = () => {
      if (nameSave) nameSave.disabled = name.value.trim() === profile.name;
    };
    const syncAvatarReset = () => {
      if (avatarReset) avatarReset.hidden = !profile.avatar;
    };

    const persistProfile = (nextName = name.value, nextAvatar = pendingAvatar, notify = false, validateName = true) => {
      const cleanName = String(nextName || '').trim();
      if (validateName) {
        nameError.textContent = cleanName.length >= 2 && cleanName.length <= 24 ? '' : '昵称需为 2–24 个字符';
        if (nameError.textContent) {
          setSaveState('保存失败');
          return false;
        }
      }
      setSaveState('正在保存');
      try {
        const nextProfile = { ...profile, name: cleanName, avatar: nextAvatar };
        safeStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
        profile = nextProfile;
        pendingAvatar = nextAvatar;
        applyProfile(nextProfile);
        syncNameSave();
        syncAvatarReset();
        setSaveState('已保存');
        if (notify) showToast('昵称已更新');
        return true;
      } catch (_) {
        setSaveState('保存失败');
        if (nextAvatar !== profile.avatar) avatarError.textContent = '头像保存空间不足，请换一张更小的图片';
        else nameError.textContent = '昵称保存失败，请重试';
        return false;
      }
    };

    name.value = profile.name;
    preview.src = resolveAvatar(profile.avatar);
    preview.addEventListener('error', () => { preview.src = DEFAULT_AVATAR; }, { once: true });
    syncNameSave();
    syncAvatarReset();

    $('[data-avatar-trigger]')?.addEventListener('click', () => input?.click());

    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        avatarError.textContent = '请选择 JPG、PNG 或 WebP 图片';
        input.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        avatarError.textContent = '图片不能超过 2MB，请压缩后重试';
        input.value = '';
        return;
      }
      avatarError.textContent = '';
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const previousAvatar = profile.avatar;
        pendingAvatar = String(reader.result || '');
        preview.src = resolveAvatar(pendingAvatar);
        if (!persistProfile(profile.name, pendingAvatar, false, false)) {
          pendingAvatar = previousAvatar;
          preview.src = resolveAvatar(previousAvatar);
        }
      });
      reader.addEventListener('error', () => { avatarError.textContent = '图片读取失败，请重新选择'; });
      reader.readAsDataURL(file);
    });

    avatarReset?.addEventListener('click', () => {
      const previousAvatar = profile.avatar;
      pendingAvatar = '';
      preview.src = DEFAULT_AVATAR;
      if (input) input.value = '';
      avatarError.textContent = '';
      if (persistProfile(profile.name, '', false, false)) showToast('已恢复系统默认头像');
      else {
        pendingAvatar = previousAvatar;
        preview.src = resolveAvatar(previousAvatar);
      }
    });

    name.addEventListener('input', () => {
      nameError.textContent = '';
      setSaveState('');
      syncNameSave();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!persistProfile(name.value, pendingAvatar, true)) name.focus();
    });
  }

  function initEmailChangeDialog() {
    const dialog = $('[data-change-email-dialog]');
    if (!dialog) return;
    const currentStep = $('[data-email-step="current"]', dialog);
    const newStep = $('[data-email-step="new"]', dialog);
    const currentEmail = $('[data-change-current-email]', dialog);
    const currentCode = $('[data-current-email-code]', dialog);
    const currentError = $('[data-current-email-code-error]', dialog);
    const newEmail = $('[data-new-email]', dialog);
    const newCode = $('[data-new-email-code]', dialog);
    const newError = $('[data-new-email-error]', dialog);
    const back = $('[data-email-back]', dialog);
    const next = $('[data-email-next]', dialog);
    const confirm = $('[data-email-confirm]', dialog);
    let currentCodeSent = false;
    let newCodeSent = false;

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const getCurrentEmail = () => readProfile().email || DEFAULT_PROFILE.email;

    function renderStep(step) {
      const isCurrent = step === 'current';
      currentStep.hidden = !isCurrent;
      newStep.hidden = isCurrent;
      back.hidden = isCurrent;
      next.hidden = !isCurrent;
      confirm.hidden = isCurrent;
      if (isCurrent) currentCode?.focus();
      else newEmail?.focus();
    }

    function resetFlow() {
      currentCodeSent = false;
      newCodeSent = false;
      currentEmail.textContent = getCurrentEmail();
      currentCode.value = '';
      currentError.textContent = '';
      newEmail.value = '';
      newCode.value = '';
      newError.textContent = '';
      renderStep('current');
    }

    $$('[data-dialog-open="change-email-dialog"]').forEach((trigger) => trigger.addEventListener('click', resetFlow));
    dialog.addEventListener('close', resetFlow);

    $('[data-send-current-email-code]', dialog)?.addEventListener('click', () => {
      currentCodeSent = true;
      currentError.textContent = '';
      showToast('验证码已发送至当前邮箱');
      currentCode.focus();
    });

    next?.addEventListener('click', () => {
      if (!currentCodeSent) {
        currentError.textContent = '请先获取验证码';
        $('[data-send-current-email-code]', dialog)?.focus();
        return;
      }
      if (currentCode.value.trim() !== EMAIL_VERIFICATION_CODE) {
        currentError.textContent = '验证码不正确，请重新输入';
        currentCode.focus();
        return;
      }
      currentError.textContent = '';
      renderStep('new');
    });

    back?.addEventListener('click', () => {
      currentCodeSent = false;
      newCodeSent = false;
      currentCode.value = '';
      newCode.value = '';
      currentError.textContent = '';
      newError.textContent = '';
      renderStep('current');
    });

    $('[data-send-new-email-code]', dialog)?.addEventListener('click', () => {
      const value = newEmail.value.trim();
      newError.textContent = '';
      if (!emailPattern.test(value)) {
        newError.textContent = '请输入有效邮箱地址';
        newEmail.focus();
        return;
      }
      if (value.toLowerCase() === getCurrentEmail().toLowerCase()) {
        newError.textContent = '新邮箱不能与当前邮箱相同';
        newEmail.focus();
        return;
      }
      newCodeSent = true;
      showToast('验证码已发送至新邮箱');
      newCode.focus();
    });

    confirm?.addEventListener('click', () => {
      const value = newEmail.value.trim();
      newError.textContent = '';
      if (!emailPattern.test(value)) {
        newError.textContent = '请输入有效邮箱地址';
        newEmail.focus();
        return;
      }
      if (value.toLowerCase() === getCurrentEmail().toLowerCase()) {
        newError.textContent = '新邮箱不能与当前邮箱相同';
        newEmail.focus();
        return;
      }
      if (!newCodeSent) {
        newError.textContent = '请先获取验证码';
        $('[data-send-new-email-code]', dialog)?.focus();
        return;
      }
      if (newCode.value.trim() !== EMAIL_VERIFICATION_CODE) {
        newError.textContent = '验证码不正确，请重新输入';
        newCode.focus();
        return;
      }
      const nextProfile = { ...readProfile(), email: value };
      safeStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
      $$('[data-profile-email-value]').forEach((node) => { node.textContent = value; });
      currentEmail.textContent = value;
      dialog.close();
      showToast('登录邮箱已更新');
    });

    resetFlow();
  }

  function initAccountActions() {
    const deleteDialog = $('#delete-account-dialog');
    const password = deleteDialog ? $('[data-delete-account-password]', deleteDialog) : null;
    const error = deleteDialog ? $('[data-delete-account-error]', deleteDialog) : null;
    const deleteButton = deleteDialog ? $('[data-account-action="delete"]', deleteDialog) : null;
    if (password && error && deleteButton) {
      const updateDeleteState = () => { deleteButton.disabled = password.value.length < 8; };
      password.addEventListener('input', () => { error.textContent = ''; updateDeleteState(); });
      deleteButton.addEventListener('click', () => {
        if (password.value.length < 8) {
          error.textContent = '请输入当前密码以确认删除账户';
          password.focus();
          return;
        }
        deleteDialog.close();
        showToast('暂时无法删除账户，请稍后再试');
      });
      updateDeleteState();
    }
    $$('[data-account-action]').filter((button) => button.dataset.accountAction !== 'delete').forEach((button) => button.addEventListener('click', () => {
      const message = '已退出登录';
      button.closest('dialog')?.close();
      showToast(message);
    }));
  }

  function initAuthForms() {
    $$('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      const passwordLabel = button.dataset.passwordLabel || '密码';
      if (button.hasAttribute('data-password-icon')) {
        button.setAttribute('aria-pressed', String(reveal));
      } else {
        button.textContent = reveal ? '隐藏' : '显示';
      }
      button.setAttribute('aria-label', `${reveal ? '隐藏' : '显示'}${passwordLabel}`);
      input.focus();
    }));

    $$('[data-auth-form]').forEach((form) => {
      const kind = form.dataset.authForm;
      const email = $('[data-auth-field="email"]', form);
      const password = $('[data-auth-field="password"]', form);
      const confirm = $('[data-auth-field="confirm"]', form);
      const submit = $('[data-auth-submit]', form);
      const formError = $('[data-auth-error="form"]', form);
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      function fieldError(field, message = '') {
        const target = $(`[data-auth-error="${field.dataset.authField}"]`, form);
        if (target) target.textContent = message;
      }

      function validate(field) {
        if (!field) return true;
        const value = field.value.trim();
        let message = '';
        if (field === email && !emailPattern.test(value)) message = '请输入有效邮箱地址';
        if (field === password) {
          if (!value) message = '请输入密码';
          else if ((kind === 'register' || kind === 'reset-password') && (value.length < 8 || value.length > 64)) message = '密码需为 8–64 个字符';
        }
        if (field === confirm && password && value !== password.value) message = '两次输入的密码不一致';
        fieldError(field, message);
        return !message;
      }

      function isReady() {
        const emailReady = !email || emailPattern.test(email.value.trim());
        if (kind === 'reset') return emailReady;
        const requiresStrongPassword = kind === 'register' || kind === 'reset-password';
        const passwordReady = !password || (password.value.length > 0 && (!requiresStrongPassword || (password.value.length >= 8 && password.value.length <= 64)));
        const confirmReady = !confirm || Boolean(password && confirm.value === password.value);
        return emailReady && passwordReady && confirmReady;
      }

      function updateSubmit() { submit.disabled = !isReady(); }
      $$('[data-auth-field]', form).forEach((field) => {
        field.addEventListener('blur', () => validate(field));
        field.addEventListener('input', () => { fieldError(field); formError.textContent = ''; updateSubmit(); });
      });
      updateSubmit();

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const fields = $$('[data-auth-field]', form);
        const valid = fields.map(validate).every(Boolean);
        if (!valid) {
          fields.find((field) => !validate(field))?.focus();
          return;
        }
        submit.disabled = true;
        const original = submit.textContent;
        submit.textContent = kind === 'login' ? '正在登录…' : kind === 'register' ? '正在创建账户…' : kind === 'reset-password' ? '正在更新…' : '正在发送…';
        window.setTimeout(() => {
          if (kind === 'login' && password.value.toLowerCase().includes('fail')) {
            formError.textContent = '邮箱或密码不正确，请重新输入';
            password.value = '';
            submit.textContent = original;
            updateSubmit();
            password.focus();
            return;
          }
          if (kind === 'register' && email.value.toLowerCase().includes('exists')) {
            formError.textContent = '该邮箱已注册，可直接登录或找回密码';
            submit.textContent = original;
            updateSubmit();
            email.focus();
            return;
          }
          if (kind === 'reset') {
            form.hidden = true;
            $('[data-reset-result]')?.removeAttribute('hidden');
            return;
          }
          if (kind === 'reset-password') {
            navigateTo('laoji-reset-password.html?mode=success');
            return;
          }
          safeStorage.setItem('laoji-authenticated', 'true');
          navigateTo('laoji-chat.html');
        }, 650);
      });
    });

    $('[data-reset-again]')?.addEventListener('click', () => {
      const form = $('[data-auth-form="reset"]');
      $('[data-reset-result]')?.setAttribute('hidden', '');
      form?.removeAttribute('hidden');
      const submit = $('[data-auth-submit]', form);
      submit.textContent = '发送重置邮件';
      submit.disabled = false;
      $('[data-auth-field="email"]', form)?.focus();
    });
  }

  function initPasswordRecovery() {
    const views = ['request', 'sent', 'expired', 'new', 'success'];
    const requestForm = $('[data-password-recovery-request]');
    if (!requestForm) return;

    const requestedMode = new URLSearchParams(window.location.search).get('mode');
    const mode = views.includes(requestedMode) ? requestedMode : 'request';
    const titles = {
      request: ['找回密码', '输入账户邮箱，我们会发送重置链接。'],
      sent: ['检查邮箱', '若账户存在，我们已发送一封重置邮件。'],
      expired: ['链接已失效', '请重新申请一封新的重置邮件。'],
      new: ['设置新密码', '请创建一个新的登录密码。'],
      success: ['密码已更新', '现在可以使用新密码登录。']
    };

    $$('[data-reset-view]').forEach((view) => { view.hidden = view.dataset.resetView !== mode; });
    $('[data-reset-card-title]')?.replaceChildren(titles[mode][0]);
    $('[data-reset-card-copy]')?.replaceChildren(titles[mode][1]);
    const activeView = $(`[data-reset-view="${mode}"]`);
    (activeView?.querySelector('input, [data-reset-view-heading]') || $('[data-reset-card-title]'))?.focus();

    const email = $('#reset-email', requestForm);
    const emailError = $('[data-reset-request-email-error]', requestForm);
    const formError = $('[data-reset-request-error]', requestForm);
    const submit = $('[data-reset-request-submit]', requestForm);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    email?.addEventListener('input', () => {
      emailError.textContent = '';
      formError.textContent = '';
    });
    requestForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const cleanEmail = email.value.trim();
      if (!emailPattern.test(cleanEmail)) {
        emailError.textContent = '请输入有效邮箱地址';
        email.focus();
        return;
      }
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = '正在发送…';
      window.setTimeout(() => {
        if (cleanEmail.toLowerCase().includes('fail')) {
          formError.textContent = '重置邮件发送失败，请稍后重试';
          submit.textContent = original;
          submit.disabled = false;
          email.focus();
          return;
        }
        navigateTo('laoji-reset-password.html?mode=sent');
      }, 650);
    });
  }

  function initChat() {
    const form = $('[data-chat-form]');
    if (!form) return;
    const input = $('[data-chat-input]', form);
    const send = $('[data-chat-send]', form);
    const thread = $('[data-chat-thread]');
    const gate = $('[data-chat-gate]');
    const draftKey = 'laoji-chat-draft';
    const configured = safeStorage.getItem('laoji-ai-configured') === 'true';
    const savedDraft = safeStorage.getItem(draftKey);
    if (savedDraft) input.value = savedDraft;
    resizeConversationInput(input);

    if (new URLSearchParams(window.location.search).get('state') === 'empty') {
      thread.hidden = true;
      $('[data-chat-empty]')?.removeAttribute('hidden');
    }

    const heading = $('[data-od-id="chat-heading"]');
    const contextLabel = $('[data-chat-context-label]');
    $$('[data-chat-session]').forEach((session) => session.addEventListener('click', () => {
      $$('[data-chat-session]').forEach((item) => {
        const active = item === session;
        item.classList.toggle('is-active', active);
        if (active) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
      if (heading) heading.textContent = session.dataset.title || '对话';
      if (contextLabel) contextLabel.textContent = session.dataset.context || '普通对话';
    }));
    $$('[data-chat-new]').forEach((button) => button.addEventListener('click', () => {
      if (heading) heading.textContent = '新对话';
      if (contextLabel) contextLabel.textContent = '未绑定书籍';
      $$('[data-chat-session]').forEach((item) => { item.classList.remove('is-active'); item.removeAttribute('aria-current'); });
      thread.hidden = true;
      $('[data-chat-empty]')?.removeAttribute('hidden');
      input.focus();
    }));

    function appendMessage(role, text, failed = false) {
      const row = document.createElement('div');
      row.className = `message-row ${role}`;
      const mark = document.createElement('span');
      mark.className = 'message-mark';
      if (role === 'assistant') {
        const image = document.createElement('img');
        image.src = DEFAULT_AVATAR;
        image.alt = '老己';
        mark.appendChild(image);
      } else {
        mark.textContent = '你';
      }
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      const copy = document.createElement('p');
      copy.textContent = text;
      bubble.appendChild(copy);
      if (failed) {
        const retry = document.createElement('button');
        retry.className = 'btn btn-small';
        retry.type = 'button';
        retry.textContent = '重试';
        retry.addEventListener('click', () => { row.remove(); input.value = '请继续整理刚才的内容'; input.focus(); send.disabled = false; });
        bubble.appendChild(retry);
      }
      row.append(mark, bubble);
      thread.appendChild(row);
      const feed = $('[data-chat-feed]');
      if (feed) feed.scrollTop = feed.scrollHeight;
      return row;
    }

    input.addEventListener('input', () => {
      safeStorage.setItem(draftKey, input.value);
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    });
    $('[data-chat-setup]')?.addEventListener('click', () => safeStorage.setItem(draftKey, input.value));
    $('[data-chat-gate-cancel]')?.addEventListener('click', () => { gate.hidden = true; input.focus(); });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || send.disabled) return;
      if (!configured) {
        gate.hidden = false;
        gate.querySelector('a')?.focus();
        return;
      }
      gate.hidden = true;
      appendMessage('user', text);
      input.value = '';
      input.style.height = 'auto';
      safeStorage.removeItem(draftKey);
      send.disabled = true;
      const waiting = appendMessage('assistant', '正在整理你的问题…');
      window.setTimeout(() => {
        waiting.remove();
        if (text.toLowerCase().includes('fail')) appendMessage('assistant', '回复生成失败。当前问题已保留，你可以重试。', true);
        else appendMessage('assistant', '我会先从相关书籍与笔记中整理观点。若要制作读书分享，请先选择一本书，再确认范围、要求和大纲。');
        send.disabled = false;
        input.focus();
      }, 700);
    });

  }

  function initDialogs() {
    const openerByDialog = new WeakMap();

    function focusDialog(dialog) {
      const autofocus = $('[autofocus]', dialog);
      const titleId = dialog.getAttribute('aria-labelledby')?.trim().split(/\s+/)[0];
      const title = titleId ? document.getElementById(titleId) : null;
      const firstControl = $('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dialog);
      (autofocus || title || firstControl)?.focus();
    }

    $$('dialog').forEach((dialog) => {
      if (dialog.__laojiDialogFocusManaged) return;
      dialog.__laojiDialogFocusManaged = true;
      const nativeShowModal = typeof dialog.showModal === 'function' ? dialog.showModal.bind(dialog) : null;
      if (nativeShowModal) {
        dialog.showModal = (trigger) => {
          openerByDialog.set(dialog, trigger || document.activeElement);
          nativeShowModal();
          focusDialog(dialog);
        };
      }
      dialog.addEventListener('close', () => {
        const trigger = openerByDialog.get(dialog);
        openerByDialog.delete(dialog);
        trigger?.focus();
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    $$('[data-dialog-open]').forEach((trigger) => {
      if (trigger.__laojiDialogOpenBound) return;
      trigger.__laojiDialogOpenBound = true;
      trigger.addEventListener('click', () => {
        const dialog = document.getElementById(trigger.dataset.dialogOpen);
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal(trigger);
      });
    });
    $$('[data-dialog-close]').forEach((trigger) => {
      if (trigger.__laojiDialogCloseBound) return;
      trigger.__laojiDialogCloseBound = true;
      trigger.addEventListener('click', () => trigger.closest('dialog')?.close());
    });
  }

  function initTabs() {
    $$('[role="tablist"]').forEach((tablist) => {
      const tabs = $$('[role="tab"]', tablist);
      const isEnabled = (tab) => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true';
      const enabledTabs = () => tabs.filter(isEnabled);
      const activate = (tab, moveFocus = false) => {
        if (!isEnabled(tab)) return;
        tabs.forEach((item) => {
          const active = item === tab;
          item.setAttribute('aria-selected', String(active));
          item.setAttribute('tabindex', active ? '0' : '-1');
        });
        const region = tablist.parentElement;
        $$('.tab-panel', region).forEach((panel) => {
          panel.hidden = panel.id !== tab.getAttribute('aria-controls');
        });
        if (moveFocus) tab.focus();
      };

      const requestedView = new URLSearchParams(window.location.search).get('view');
      const requestedTab = requestedView === 'ppt' ? tabs.find((tab) => tab.getAttribute('aria-controls') === 'ppt-panel' && isEnabled(tab)) : null;
      const selected = requestedTab || tabs.find((tab) => tab.getAttribute('aria-selected') === 'true' && isEnabled(tab)) || enabledTabs()[0];
      if (selected) activate(selected);

      tabs.forEach((tab) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', (event) => {
          const available = enabledTabs();
          const index = available.indexOf(tab);
          if (index < 0 || available.length === 0) return;
          let next = null;
          if (event.key === 'ArrowLeft') next = available[(index - 1 + available.length) % available.length];
          if (event.key === 'ArrowRight') next = available[(index + 1) % available.length];
          if (event.key === 'Home') next = available[0];
          if (event.key === 'End') next = available[available.length - 1];
          if (!next) return;
          event.preventDefault();
          activate(next, true);
        });
      });
    });
  }

  function initSegments() {
    $$('[data-segment-group]').forEach((group) => {
      const buttons = $$('[data-segment]', group);
      buttons.forEach((button) => button.addEventListener('click', () => {
        buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        group.dispatchEvent(new CustomEvent('segmentchange', { bubbles: true, detail: button.dataset.segment }));
      }));
    });
  }

  function createNoteSaveGate() {
    let generation = 0;
    return {
      start() { generation += 1; return generation; },
      invalidate() { generation += 1; },
      isCurrent(token) { return token === generation; }
    };
  }

  function runCurrentNoteSave(gate, token, target, operation) {
    if (!gate.isCurrent(token)) return false;
    operation(target);
    return true;
  }

  function createNoteDeleteGate() {
    let active = null;
    let serial = 0;
    const failed = new Set();
    return {
      start(id, forceFailure) {
        if (active) return null;
        active = { id, serial: ++serial, forceFailure: Boolean(forceFailure) };
        return active;
      },
      isCurrent(token) { return Boolean(active && token && active.serial === token.serial && active.id === token.id); },
      shouldFail(token) {
        if (!this.isCurrent(token) || !token.forceFailure || failed.has(token.id)) return false;
        failed.add(token.id);
        return true;
      },
      finish(token) { if (this.isCurrent(token)) active = null; },
      cancel() { active = null; },
      isBusy() { return Boolean(active); }
    };
  }

  function createWeReadSyncGate() {
    let active = null;
    let serial = 0;
    const partialFailures = new Set();
    return {
      start() {
        if (active) return null;
        active = { serial: ++serial };
        return active;
      },
      isCurrent(token) { return Boolean(active && token && active.serial === token.serial); },
      finish(token) { if (this.isCurrent(token)) active = null; },
      shouldPartiallyFail(token) {
        if (!this.isCurrent(token) || partialFailures.has('weread')) return false;
        partialFailures.add('weread');
        return true;
      },
      isBusy() { return Boolean(active); }
    };
  }

  function getWeReadSyncOutcome({ mode, gate, token }) {
    if (mode === 'expired') return 'invalid';
    if (mode === 'partial' && gate.shouldPartiallyFail(token)) return 'partial';
    return 'connected';
  }

  function initNotes() {
    const list = $('[data-notes-list]');
    const empty = $('[data-notes-empty]');
    const form = $('[data-note-form]');
    if (!list || !empty || !form) return;
    const dialog = form.closest('dialog');
    const body = $('#note-body', form);
    const tags = $('#note-tags', form);
    const status = $('[data-note-form-status]', form);
    const submit = $('[data-note-form-submit]', form);
    const title = $('[data-note-form-title]', dialog);
    const emptyTitle = $('[data-notes-empty-title]', empty);
    const emptyCopy = $('[data-notes-empty-copy]', empty);
    const emptyActions = $('[data-notes-empty-actions]', empty);
    const group = $('[data-segment-group]');
    const deleteDialog = $('#delete-note-dialog');
    const deleteTitle = deleteDialog ? $('[data-note-delete-title]', deleteDialog) : null;
    const deleteStatus = deleteDialog ? $('[data-note-delete-status]', deleteDialog) : null;
    const deleteConfirm = deleteDialog ? $('[data-note-delete-confirm]', deleteDialog) : null;
    const forcedEmpty = new URLSearchParams(window.location.search).get('notes') === 'empty';
    const saveGate = createNoteSaveGate();
    const deleteGate = createNoteDeleteGate();
    let active = $('[data-segment][aria-pressed="true"]', group)?.dataset.segment || 'mine';
    let editing = null;
    let pendingSave = null;
    let pendingDelete = null;

    function setStatus(message = '', error = false) {
      status.textContent = message;
      status.classList.toggle('error', error);
    }

    function render() {
      let visible = 0;
      $$('[data-note-card]', list).forEach((card) => {
        const show = !forcedEmpty && card.dataset.noteKind === active;
        card.hidden = !show;
        if (show) visible += 1;
      });
      list.hidden = visible === 0;
      empty.hidden = visible !== 0;
      const publicEmpty = active === 'public';
      emptyTitle.textContent = publicEmpty ? '暂无书友笔记' : '还没有老己笔记';
      emptyCopy.textContent = publicEmpty ? '本书目前没有可用的热门划线或高赞评价。' : '记录你的理解和下一步行动，之后会显示在这里。';
      emptyActions.hidden = publicEmpty;
    }

    function removeSupplement(card) {
      const supplement = $('.supplement', card);
      supplement?.remove();
      $$('[data-note-edit], [data-note-delete]', card).forEach((button) => button.remove());
      card.dataset.noteSupplementDeleted = 'true';
      if (!$('blockquote', card)) card.remove();
    }

    function applyDeletedSupplements() {
      $$('[data-note-card]', list).forEach((card) => {
        const id = card.dataset.noteId;
        if (id && window.LaojiState?.isNoteSupplementDeleted(id)) removeSupplement(card);
      });
    }

    function openDeleteNote(card) {
      if (!card || deleteGate.isBusy()) return;
      pendingDelete = card;
      if (deleteTitle) deleteTitle.textContent = '删除这条老己笔记？';
      if (deleteStatus) deleteStatus.textContent = '只会删除这条老己笔记，引用原文、划线和书籍会保留。';
      if (deleteConfirm) { deleteConfirm.disabled = false; deleteConfirm.textContent = '删除笔记'; }
      if (deleteDialog && typeof deleteDialog.showModal === 'function' && !deleteDialog.open) deleteDialog.showModal();
    }

    function openNewNote() {
      cancelPendingSave();
      editing = null;
      form.reset();
      title.textContent = '新建老己笔记';
      setStatus();
    }

    function openEditNote(card) {
      cancelPendingSave();
      editing = card;
      body.value = $('[data-note-body]', card)?.textContent.trim() || '';
      tags.value = ($('[data-note-tags]', card)?.textContent || '').replace(/^标签：\s*/, '');
      title.textContent = '编辑老己笔记';
      setStatus();
      if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      body.focus();
    }

    function createNoteCard(noteBody, noteTags) {
      const card = document.createElement('article');
      card.className = 'card source-card';
      card.dataset.noteCard = '';
      card.dataset.noteKind = 'mine';
      card.dataset.noteId = `note-${Date.now()}`;
      const head = document.createElement('div');
      head.className = 'source-head';
      const label = document.createElement('span');
      label.textContent = '老己笔记 · 私有';
      const time = document.createElement('span');
      time.textContent = '刚刚保存';
      head.append(label, time);
      const supplement = document.createElement('div');
      supplement.className = 'supplement';
      const supplementLabel = document.createElement('div');
      supplementLabel.className = 'supplement-label';
      supplementLabel.textContent = '老己笔记';
      const copy = document.createElement('p');
      copy.dataset.noteBody = '';
      copy.textContent = noteBody;
      const tagCopy = document.createElement('p');
      tagCopy.className = 'muted';
      tagCopy.style.margin = '6px 0 0';
      tagCopy.dataset.noteTags = '';
      tagCopy.hidden = !noteTags;
      tagCopy.textContent = noteTags ? `标签：${noteTags}` : '';
      supplement.append(supplementLabel, copy, tagCopy);
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const edit = document.createElement('button');
      edit.className = 'btn';
      edit.type = 'button';
      edit.dataset.noteEdit = '';
      edit.textContent = '编辑';
      edit.addEventListener('click', () => openEditNote(card));
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost';
      remove.type = 'button';
      remove.dataset.noteDelete = '';
      remove.dataset.dialogOpen = 'delete-note-dialog';
      remove.textContent = '删除笔记';
      remove.addEventListener('click', () => openDeleteNote(card));
      actions.append(edit, remove);
      card.append(head, supplement, actions);
      return card;
    }

    function cancelPendingSave() {
      if (pendingSave === null) return;
      saveGate.invalidate();
      pendingSave = null;
      submit.disabled = false;
      submit.textContent = '保存';
    }

    group?.addEventListener('segmentchange', (event) => {
      active = event.detail;
      render();
    });
    $$('[data-dialog-open="new-note-dialog"]').forEach((trigger) => trigger.addEventListener('click', openNewNote));
    $$('[data-note-edit]', list).forEach((button) => button.addEventListener('click', () => openEditNote(button.closest('[data-note-card]'))));
    $$('[data-note-delete]', list).forEach((button) => button.addEventListener('click', () => openDeleteNote(button.closest('[data-note-card]'))));
    dialog?.addEventListener('close', cancelPendingSave);
    deleteDialog?.addEventListener('close', () => {
      if (deleteGate.isBusy()) deleteGate.cancel();
      pendingDelete = null;
    });
    deleteConfirm?.addEventListener('click', () => {
      const card = pendingDelete;
      const id = card?.dataset.noteId;
      if (!card || !id || !window.LaojiState || deleteGate.isBusy()) return;
      const token = deleteGate.start(id, new URLSearchParams(window.location.search).get('noteDelete') === 'error');
      if (!token) return;
      deleteConfirm.disabled = true;
      deleteConfirm.textContent = '正在删除…';
      if (deleteStatus) deleteStatus.textContent = '正在删除你的补充…';
      window.setTimeout(() => {
        if (!deleteGate.isCurrent(token)) return;
        if (deleteGate.shouldFail(token)) {
          deleteGate.finish(token);
          deleteConfirm.disabled = false;
          deleteConfirm.textContent = '重试删除';
          if (deleteStatus) deleteStatus.textContent = '删除失败，补充仍保留。请重试。';
          deleteConfirm.focus();
          return;
        }
        const deleted = window.LaojiState.deleteNoteSupplement(id);
        deleteGate.finish(token);
        if (!deleted) return;
        removeSupplement(card);
        pendingDelete = null;
        deleteDialog?.close();
        $('[data-dialog-open="new-note-dialog"]')?.focus();
        showToast('老己笔记已删除');
        render();
      }, 420);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const noteBody = body.value.trim();
      const noteTags = tags.value.trim();
      if (!noteBody) {
        setStatus('请先填写笔记内容。', true);
        body.focus();
        return;
      }
      const target = editing;
      const isEditing = Boolean(target);
      const token = saveGate.start();
      pendingSave = token;
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = '正在保存…';
      setStatus('正在保存…');
      window.setTimeout(() => {
        if (!saveGate.isCurrent(token)) return;
        if (noteBody.toLowerCase().includes('fail')) {
          setStatus('保存失败，内容已保留，请重试。', true);
          pendingSave = null;
          submit.disabled = false;
          submit.textContent = original;
          body.focus();
          return;
        }
        runCurrentNoteSave(saveGate, token, target, (savedTarget) => {
          if (savedTarget) {
            $('[data-note-body]', savedTarget).textContent = noteBody;
            const tagCopy = $('[data-note-tags]', savedTarget);
            tagCopy.textContent = noteTags ? `标签：${noteTags}` : '';
            tagCopy.hidden = !noteTags;
          } else {
            list.prepend(createNoteCard(noteBody, noteTags));
            active = 'mine';
            $$('[data-segment]', group).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.segment === active)));
          }
        });
        setStatus('已保存');
        showToast(isEditing ? '老己笔记已更新' : '老己笔记已保存');
        form.reset();
        editing = null;
        pendingSave = null;
        submit.disabled = false;
        submit.textContent = '保存';
        dialog?.close();
        render();
      }, 650);
    });
    applyDeletedSupplements();
    render();
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      openNewNote();
      if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    }
  }

  function getBookEmptyDisplayState(requested) {
    const state = typeof requested === 'string' ? requested.replace(/^empty-/, '') : '';
    if (!['mine', 'public', 'notes', 'ppt'].includes(state)) return null;
    return { state, panelId: `${state}-panel`, showEmpty: true, showContent: false };
  }

  function initBookEmptyStates() {
    const requested = new URLSearchParams(window.location.search).get('book');
    const display = getBookEmptyDisplayState(requested);
    if (!display) return;
    const tablist = $('[role="tablist"][aria-label="书籍内容"]');
    const region = tablist?.parentElement;
    $$('[role="tab"]', tablist).forEach((tab) => {
      const active = tab.getAttribute('aria-controls') === display.panelId;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });
    $$('.tab-panel', region).forEach((panel) => { panel.hidden = panel.id !== display.panelId; });
    const list = $(`[data-book-list="${display.state}"]`);
    const empty = $(`[data-book-empty="${display.state}"]`);
    if (list) list.hidden = !display.showContent;
    if (empty) empty.hidden = !display.showEmpty;
  }

  function getLibraryDisplayState({ loading, totalBooks, visibleBooks }) {
    const showLoading = Boolean(loading);
    const showTrueEmpty = !showLoading && totalBooks === 0;
    const showSearchEmpty = !showLoading && totalBooks > 0 && visibleBooks === 0;
    return {
      showLoading,
      showGrid: !showLoading && totalBooks > 0,
      showTrueEmpty,
      showSearchEmpty
    };
  }

  function createImportTaskGate() {
    let generation = 0;
    return {
      start() { generation += 1; return generation; },
      invalidate() { generation += 1; },
      isCurrent(token) { return token === generation; }
    };
  }

  function runCurrentImportTask(gate, token, operation) {
    if (!gate.isCurrent(token)) return false;
    operation();
    return true;
  }

  function initLibrary() {
    const grid = $('[data-book-grid]');
    if (!grid) return;
    const search = $('[data-library-search]');
    const sourceGroup = $('[data-library-source]');
    const empty = $('[data-library-empty]');
    const loading = $('[data-library-loading]');
    const trueEmpty = $('[data-library-true-empty]');
    const count = $('[data-library-count]');
    const forcedLoading = new URLSearchParams(window.location.search).get('library') === 'loading';
    let source = 'all';
    window.LaojiState?.seed();
    const syncFeedback = $('[data-weread-sync-feedback]');
    const syncTitle = $('[data-weread-sync-title]');
    const syncCopy = $('[data-weread-sync-copy]');
    const syncReconnect = $('[data-weread-sync-reconnect]');
    const syncGate = createWeReadSyncGate();
    const syncMode = new URLSearchParams(window.location.search).get('sync');

    function setWereadConnection(value) {
      window.LaojiState?.setConnection('weread', value);
      safeStorage.setItem('laoji-weread-connected', String(value === 'connected'));
      applyConnectionStatus($$('[data-weread-connection-state], [data-connection-top-status="weread"]'), value);
    }

    function renderSyncFeedback(kind = '') {
      if (!syncFeedback) return;
      syncFeedback.hidden = !kind;
      if (syncReconnect) syncReconnect.hidden = kind !== 'invalid';
      if (kind === 'syncing') {
        syncTitle.textContent = '正在更新微信读书内容';
        syncCopy.textContent = '书架、进度和笔记正在更新。';
      } else if (kind === 'partial') {
        syncTitle.textContent = '部分内容暂未更新';
        syncCopy.textContent = '已有内容仍可查看，系统稍后会自动重试。';
      } else if (kind === 'invalid') {
        syncTitle.textContent = '微信读书连接已失效';
        syncCopy.textContent = '已有内容仍可阅读，重新连接后会自动更新。';
      } else if (kind === 'success') {
        syncTitle.textContent = '微信读书内容已更新';
        syncCopy.textContent = '书架、进度和笔记已更新。';
      }
    }

    function startWereadSync() {
      const state = window.LaojiState?.getConnection('weread') || 'disconnected';
      if (state === 'invalid') {
        navigateTo('laoji-weread-setup.html?return=laoji-library.html');
        return;
      }
      if (!['connected', 'partial'].includes(state)) return;
      const token = syncGate.start();
      if (!token) return;
      setWereadConnection('syncing');
      renderSyncFeedback('syncing');
      window.setTimeout(() => {
        if (!syncGate.isCurrent(token)) return;
        const outcome = getWeReadSyncOutcome({ mode: syncMode === 'error' ? 'partial' : syncMode, gate: syncGate, token });
        syncGate.finish(token);
        setWereadConnection(outcome);
        renderSyncFeedback(outcome === 'connected' ? 'success' : outcome);
      }, 650);
    }

    const wereadState = window.LaojiState?.getConnection('weread') || 'disconnected';
    if (['connected', 'partial'].includes(wereadState)) startWereadSync();
    if (wereadState === 'invalid') renderSyncFeedback('invalid');

    function renderBooks() {
      const books = window.LaojiState?.listLibraryBooks() || [];
      grid.replaceChildren(...books.map((book) => createLibraryCard(book)));
      if (count) count.textContent = books.length ? `${books.length} 本书` : '书架暂无书籍';
      update();
    }

    function update() {
      const term = (search?.value || '').trim().toLocaleLowerCase('zh-CN');
      let visible = 0;
      const cards = $$('[data-book]', grid);
      cards.forEach((card) => {
        const haystack = `${card.dataset.title} ${card.dataset.author}`.toLocaleLowerCase('zh-CN');
        const matches = (!term || haystack.includes(term)) && (source === 'all' || card.dataset.source === source);
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      const display = getLibraryDisplayState({ loading: forcedLoading, totalBooks: cards.length, visibleBooks: visible });
      if (loading) loading.hidden = !display.showLoading;
      grid.hidden = !display.showGrid;
      if (trueEmpty) trueEmpty.hidden = !display.showTrueEmpty;
      if (empty) {
        empty.hidden = !display.showSearchEmpty;
        const query = $('[data-empty-query]', empty);
        if (query) query.textContent = term ? `“${search.value.trim()}”` : source === 'weread' ? '微信读书' : '我的导入';
      }
    }

    search?.addEventListener('input', update);
    sourceGroup?.addEventListener('segmentchange', (event) => { source = event.detail; update(); });
    $('[data-clear-search]')?.addEventListener('click', () => { search.value = ''; source = 'all'; $$('[data-segment]', sourceGroup).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.segment === 'all'))); update(); search.focus(); });
    $('[data-library-sort]')?.addEventListener('change', (event) => showToast(`已按${event.target.selectedOptions[0].textContent}排序`));
    document.addEventListener('laoji:librarychange', renderBooks);
    renderBooks();
  }

  const LIBRARY_COVER_SOURCES = Object.freeze({
    '原子习惯': 'assets/covers/atomic-habits.svg',
    '深度工作': 'assets/covers/deep-work.svg',
    '被讨厌的勇气': 'assets/covers/courage-to-be-disliked.svg',
    '思考，快与慢': 'assets/covers/thinking-fast-and-slow.svg',
    '也许你该找个人聊聊：一个心理治疗师眼中的疗愈故事': 'assets/covers/maybe-you-should-talk.svg'
  });

  function createLibraryCard(book) {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.dataset.book = '';
    card.dataset.title = book.title;
    card.dataset.author = book.author;
    card.dataset.source = book.source || 'local';
    card.dataset.odId = `book-card-${book.id}`;
    const link = document.createElement('a');
    link.href = book.href || (book.format === 'PDF' ? 'laoji-pdf-reader.html' : 'laoji-epub-reader.html');
    link.setAttribute('aria-label', `打开《${book.title}》`);
    const cover = document.createElement('img');
    cover.className = 'book-cover-image';
    cover.src = book.coverSrc || LIBRARY_COVER_SOURCES[book.title] || 'assets/covers/generic-book.svg';
    cover.alt = '';
    cover.width = 360;
    cover.height = 540;
    cover.loading = 'lazy';
    cover.decoding = 'async';
    link.append(cover);
    card.append(link);
    return card;
  }

  function initLibraryImport() {
    const dialog = $('#import-dialog');
    if (!dialog || !window.LaojiState) return;
    const open = $('[data-import-open]');
    const input = $('#book-file');
    const task = $('[data-import-task]', dialog);
    const filename = $('[data-import-filename]', dialog);
    const status = $('[data-import-status]', dialog);
    const retry = $('[data-import-retry]', dialog);
    const remove = $('[data-import-remove]', dialog);
    const next = $('[data-import-next]', dialog);
    const read = $('[data-import-read]', dialog);
    const ppt = $('[data-import-ppt]', dialog);
    if (!open || !input || !task || !filename || !status || !retry || !remove || !next || !read || !ppt) return;
    window.LaojiState.seed();
    const taskGate = createImportTaskGate();

    function resetTask() {
      taskGate.invalidate();
      input.value = '';
      task.hidden = true;
      filename.textContent = '';
      status.textContent = '';
      retry.hidden = true;
      next.hidden = true;
      read.removeAttribute('href');
      ppt.removeAttribute('href');
    }

    function importBook() {
      taskGate.invalidate();
      const file = input.files?.[0];
      const extension = file?.name.split('.').pop()?.toLowerCase();
      task.hidden = false;
      filename.textContent = file?.name || '未选择文件';
      if (!file || !['epub', 'pdf'].includes(extension)) {
        status.textContent = '无法导入此文件。请选择 EPUB 或 PDF。';
        retry.hidden = true;
        return;
      }
      status.textContent = '正在解析书籍…';
      retry.hidden = true;
      const taskToken = taskGate.start();
      window.setTimeout(() => {
        runCurrentImportTask(taskGate, taskToken, () => {
          if (file.name.toLowerCase().includes('fail')) {
            status.textContent = '导入失败，文件仍已保留，可以重试。';
            retry.hidden = false;
            return;
          }
          const normalizedName = file.name.replace(/\.[^.]+$/, '');
          const id = `import-${file.name.toLocaleLowerCase('zh-CN').replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')}-${file.size || 0}`;
          const book = window.LaojiState.addLibraryBook({ id, title: normalizedName, author: '', format: extension.toUpperCase(), source: 'local', href: extension === 'pdf' ? 'laoji-pdf-reader.html' : 'laoji-epub-reader.html', cover: 'sage' });
          status.textContent = '已导入。现在可以继续阅读，或直接开始制作 PPT。';
          retry.hidden = true;
          remove.hidden = true;
          read.href = book.href;
          ppt.href = `laoji-ppt-materials.html?book=${encodeURIComponent(book.id)}`;
          next.hidden = false;
          document.dispatchEvent(new CustomEvent('laoji:librarychange'));
        });
      }, 700);
    }

    open.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      taskGate.invalidate();
      const file = input.files?.[0];
      if (!file) return resetTask();
      if (!dialog.open) dialog.showModal(open);
      remove.hidden = false;
      next.hidden = true;
      importBook();
    });
    retry.addEventListener('click', importBook);
    remove.addEventListener('click', resetTask);
    dialog.addEventListener('close', resetTask);
  }

  function initPanels() {
    $$('[data-panel-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = document.getElementById(button.dataset.panelToggle);
        if (!panel) return;
        const open = !panel.hidden;
        panel.hidden = open;
        button.setAttribute('aria-expanded', String(!open));
      });
    });
    $$('[data-note-action]').forEach((button) => button.addEventListener('click', () => {
      const panel = $('#reader-notes');
      if (panel) {
        panel.hidden = false;
        panel.querySelector('textarea')?.focus();
      }
      showToast('已定位到老己笔记');
    }));
  }

  function initPdfStates() {
    const switcher = $('[data-pdf-switcher]');
    if (!switcher) return;
    const state = new URLSearchParams(window.location.search).get('state') || 'normal';
    $$('[data-pdf-state]').forEach((panel) => panel.hidden = panel.dataset.pdfState !== state);
  }

  const PPT_OUTLINE_KEY = 'laoji-ppt-outline';
  const PPT_OUTLINE_CONFIRMED_KEY = 'laoji-ppt-outline-confirmed';
  const PPT_DEFAULT_SLIDES = [
    ['让好习惯自然发生', '从最小行动开始，让环境替你降低阻力。', '从一个微小动作开始的路径示意'],
    ['为什么目标常常失效', '目标说明方向，但系统决定每天会发生什么。', '目标与系统的对比图'],
    ['行动系统', '缩小行动\n设计环境\n给进步即时反馈', '环境提示与最小行动的关系示意'],
    ['工作场景练习', '用两个真实工作场景拆解提示、行动与奖励。', '工作场景的习惯循环图'],
    ['从今天开始', '选择一个两分钟内可以完成的起步动作。', '今天开始行动的清单']
  ];

  function isOutlineConfirmed(storage = safeStorage) {
    return storage.getItem(PPT_OUTLINE_CONFIRMED_KEY) === 'true';
  }

  function invalidateOutlineConfirmation(storage = safeStorage) {
    storage.removeItem(PPT_OUTLINE_CONFIRMED_KEY);
  }

  function readMaterialDraft(storage = safeStorage) {
    try {
      const draft = JSON.parse(storage.getItem('laoji-material-draft') || 'null');
      return draft && typeof draft === 'object' ? draft : {};
    } catch (_) {
      return {};
    }
  }

  function readPptOutline(storage = safeStorage) {
    try {
      const stored = JSON.parse(storage.getItem(PPT_OUTLINE_KEY) || 'null');
      if (Array.isArray(stored?.slides) && stored.slides.length && stored.slides.every((slide) => Array.isArray(slide) && slide.length >= 2)) {
        return {
          slides: stored.slides.map(([title, points, imageIntent]) => [String(title), String(points), String(imageIntent || '')]),
          active: Number.isInteger(stored.active) ? stored.active : 0
        };
      }
    } catch (_) { /* Fall through to the usable default outline. */ }
    return { slides: PPT_DEFAULT_SLIDES.map((slide) => [...slide]), active: 2 };
  }

  function createGenerationRunGate() {
    let activeToken = 0;
    let running = false;
    return {
      start() {
        if (running) return null;
        running = true;
        activeToken += 1;
        return activeToken;
      },
      isCurrent(token) { return running && token === activeToken; },
      finish(token) {
        if (!this.isCurrent(token)) return false;
        running = false;
        return true;
      },
      get running() { return running; }
    };
  }

  function initMaterials() {
    const form = $('[data-material-form]');
    if (!form) return;
    const structuredGroups = $$('[data-ppt-choice-group]', form);
    if (structuredGroups.length) {
      const draft = readMaterialDraft();
      const generate = $('[data-generate-outline]', form);
      const configured = safeStorage.getItem('laoji-ai-configured') === 'true';
      const directOutlineNavigation = form.hasAttribute('data-outline-direct-navigation');
      const defaultDraft = { scope: 'whole-book', purpose: '读书分享', audience: '同事', pageCount: '8' };

      function selectedValue(group) {
        return $('[data-choice-value][aria-pressed="true"]', group)?.dataset.choiceValue;
      }

      function saveStructuredDraft() {
        const nextDraft = { ...draft };
        structuredGroups.forEach((group) => { nextDraft[group.dataset.draftField] = selectedValue(group); });
        nextDraft.friendOpinion = Boolean($('[data-friend-opinion]', form)?.checked);
        safeStorage.setItem('laoji-material-draft', JSON.stringify(nextDraft));
      }

      structuredGroups.forEach((group) => {
        const field = group.dataset.draftField;
        const savedValue = draft[field] || defaultDraft[field];
        const choices = $$('[data-choice-value]', group);
        if (choices.some((choice) => choice.dataset.choiceValue === savedValue)) {
          choices.forEach((choice) => {
            const active = choice.dataset.choiceValue === savedValue;
            choice.setAttribute('aria-pressed', String(active));
            choice.classList.toggle('is-selected', active);
          });
        }
        choices.forEach((choice) => choice.addEventListener('click', () => {
          choices.forEach((item) => {
            const active = item === choice;
            item.setAttribute('aria-pressed', String(active));
            item.classList.toggle('is-selected', active);
          });
          saveStructuredDraft();
        }));
      });
      const friendOpinion = $('[data-friend-opinion]', form);
      if (friendOpinion) {
        friendOpinion.checked = Boolean(draft.friendOpinion);
        friendOpinion.addEventListener('change', saveStructuredDraft);
      }
      saveStructuredDraft();

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (generate?.disabled) return;
        saveStructuredDraft();
        function restoreGenerateAction(destination) {
          if (destination === null && generate) {
            generate.disabled = false;
            generate.textContent = '生成大纲';
          }
        }
        function recoverFromBlockedNavigation(navigation) {
          if (navigation?.then) navigation.then(restoreGenerateAction).catch(() => restoreGenerateAction(null));
        }
        if (!configured && !directOutlineNavigation) {
          if (form.closest('.chat-page')) safeStorage.setItem('laoji-ppt-chat-scope-open', 'true');
          const returnTarget = `${window.location.pathname.split('/').pop()}${window.location.search}`;
          if (generate) {
            generate.disabled = true;
            generate.textContent = '前往配置 AI…';
          }
          const navigation = navigateTo(`laoji-ai-setup.html?return=${encodeURIComponent(returnTarget)}`);
          recoverFromBlockedNavigation(navigation);
          return;
        }
        invalidateOutlineConfirmation();
        if (generate) {
          generate.disabled = true;
          generate.textContent = '正在生成大纲…';
        }
        const params = new URLSearchParams(window.location.search);
        const target = new URL('laoji-ppt-outline.html', window.location.href);
        ['conversation', 'from', 'book'].forEach((key) => { if (params.get(key)) target.searchParams.set(key, params.get(key)); });
        window.setTimeout(() => {
          const navigation = navigateTo(`${target.pathname.split('/').pop()}${target.search}`);
          recoverFromBlockedNavigation(navigation);
        }, 700);
      });
      return;
    }
    const scopeOptions = $$('[data-scope-option]');
    const scopeChoices = $$('[data-ppt-scope-choice]');
    const chapterOptions = $$('[data-chapter-option]');
    const friendOpinion = $('[data-friend-opinion]');
    const chapterScope = $('[data-chapter-scope]');
    const count = $('[data-selected-count]');
    const generate = $('[data-generate-outline]');
    const setupLink = $('[data-ai-setup-link]', form);
    const pageCountGroup = $('[data-segment-group]', form);
    const pageCountSegments = pageCountGroup ? $$('[data-segment]', pageCountGroup) : [];
    const configured = safeStorage.getItem('laoji-ai-configured') === 'true';
    const forcedState = new URLSearchParams(window.location.search).get('state');
    const regions = $$('[data-material-state]');
    function setState(state) {
      regions.forEach((region) => { region.hidden = region.dataset.materialState !== state; });
    }
    const draft = readMaterialDraft();
    if (scopeChoices.some((button) => button.dataset.pptScopeChoice === draft.scope)) {
      scopeChoices.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pptScopeChoice === draft.scope)));
    } else if (scopeOptions.some((input) => input.value === draft.scope)) {
      scopeOptions.forEach((input) => { input.checked = input.value === draft.scope; });
    }
    chapterOptions.forEach((input, index) => { if (typeof draft.chapters?.[index] === 'boolean') input.checked = draft.chapters[index]; });
    if (friendOpinion && typeof draft.friendOpinion === 'boolean') friendOpinion.checked = draft.friendOpinion;
    if ($('#ppt-topic')) $('#ppt-topic').value = draft.topic || $('#ppt-topic').value;
    if ($('#purpose')) $('#purpose').value = draft.purpose || $('#purpose').value;
    if ($('#audience')) $('#audience').value = draft.audience || $('#audience').value;
    if ($('#ppt-notes')) $('#ppt-notes').value = draft.notes || $('#ppt-notes').value;
    if ($('#page-count') && ['8', '12', '16', 'custom'].includes(draft.pageCount)) $('#page-count').value = draft.pageCount;
    if (pageCountSegments.some((button) => button.dataset.segment === draft.pageCount)) {
      pageCountSegments.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.segment === draft.pageCount)));
    }
    if (configured) {
      const notice = $('[data-ai-config-notice]', form);
      if (notice) {
        notice.classList.remove('warning');
        notice.innerHTML = '<span class="notice-dot"></span><p><strong>AI 服务已连接</strong><br><span class="muted">生成大纲后，请逐页检查并确认内容。</span></p>';
      }
      if (setupLink) setupLink.textContent = '查看 AI 设置';
    }
    function getSelectedScope() {
      return scopeChoices.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.pptScopeChoice
        || scopeOptions.find((input) => input.checked)?.value
        || 'all-notes';
    }
    function saveDraft() {
      safeStorage.setItem('laoji-material-draft', JSON.stringify({
        scope: getSelectedScope(),
        chapters: chapterOptions.map((input) => input.checked),
        friendOpinion: Boolean(friendOpinion?.checked),
        topic: $('#ppt-topic')?.value,
        purpose: $('#purpose')?.value,
        audience: $('#audience')?.value,
        notes: $('#ppt-notes')?.value,
        pageCount: $('#page-count')?.value || pageCountSegments.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.segment
      }));
    }
    setupLink?.addEventListener('click', saveDraft);
    pageCountGroup?.addEventListener('segmentchange', saveDraft);
    $('[data-material-return]')?.addEventListener('click', () => setState('content'));
    $('[data-material-retry]')?.addEventListener('click', () => {
      setState('content');
      form.requestSubmit?.();
    });
    function update() {
      const selectedScope = getSelectedScope();
      const isChapterScope = selectedScope === 'chapters';
      if (chapterScope) chapterScope.hidden = !isChapterScope;
      const chapterCount = chapterOptions.filter((input) => input.checked).length;
      const labels = { 'all-notes': '全部笔记', chapters: `${chapterCount} 个章节`, 'laoji-notes': '老己笔记' };
      if (count) count.textContent = labels[selectedScope];
      if (generate) generate.disabled = isChapterScope && chapterCount === 0;
      saveDraft();
    }
    [...scopeOptions, ...chapterOptions, friendOpinion].filter(Boolean).forEach((input) => input.addEventListener('change', update));
    scopeChoices.forEach((button) => button.addEventListener('click', update));
    ['ppt-topic', 'purpose', 'audience', 'page-count', 'ppt-notes'].forEach((id) => document.getElementById(id)?.addEventListener('input', saveDraft));
    update();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (generate.disabled) return;
      saveDraft();
      if (!configured) {
        navigateTo('laoji-ai-setup.html');
        return;
      }
      invalidateOutlineConfirmation();
      generate.disabled = true;
      generate.textContent = '正在生成大纲…';
      const params = new URLSearchParams(window.location.search);
      const target = new URL('laoji-ppt-outline.html', window.location.href);
      ['conversation', 'from', 'book'].forEach((key) => { if (params.get(key)) target.searchParams.set(key, params.get(key)); });
      window.setTimeout(() => { navigateTo(`${target.pathname.split('/').pop()}${target.search}`); }, 700);
    });
    setState(['loading', 'empty', 'error'].includes(forcedState) ? forcedState : 'content');
  }

  function readOutlineDocument(root) {
    return $$('[data-outline-page]', root).map((page) => [
      $('[data-outline-title]', page)?.innerText.trim() || '未命名页面',
      $('[data-outline-points]', page)?.innerText.trim() || '',
      $('[data-outline-image-intent]', page)?.innerText.trim() || ''
    ]);
  }

  function createOutlinePage(slide, index) {
    const article = document.createElement('article');
    article.className = 'ppt-outline-page';
    article.dataset.outlinePage = '';
    article.dataset.slideId = `slide-${index + 1}`;
    article.innerHTML = `<div class="ppt-outline-page-head"><span class="data"></span><span class="ppt-outline-page-type">内容页</span><button class="btn btn-ghost ppt-outline-delete" type="button" data-delete-outline-page>删除</button></div><h3 data-outline-title contenteditable="true" role="textbox"></h3><div class="ppt-outline-points" data-outline-points contenteditable="true" role="textbox"></div><p class="ppt-outline-intent"><span>配图意图</span><span data-outline-image-intent contenteditable="true" role="textbox"></span></p><details class="ppt-outline-sources"><summary>引用来源</summary><p>来源会随当前书籍与范围保留。</p></details>`;
    $('.data', article).textContent = String(index + 1).padStart(2, '0');
    const title = $('[data-outline-title]', article);
    const points = $('[data-outline-points]', article);
    const intent = $('[data-outline-image-intent]', article);
    title.textContent = slide[0];
    title.setAttribute('aria-label', `第 ${index + 1} 页标题`);
    points.textContent = slide[1];
    points.setAttribute('aria-label', `第 ${index + 1} 页内容`);
    intent.textContent = slide[2] || '';
    intent.setAttribute('aria-label', `第 ${index + 1} 页配图意图`);
    $('[data-delete-outline-page]', article).setAttribute('aria-label', `删除第 ${index + 1} 页`);
    return article;
  }

  function renderOutlineDocument(root, slides) {
    root.replaceChildren(...slides.map(createOutlinePage));
  }

  function initOutline() {
    const editor = $('[data-outline-editor]');
    if (!editor) return;
    const documentRoot = $('[data-outline-document]', editor);
    if (!documentRoot) return;
    const saveRegions = $$('[data-save-status]');
    const forcedState = new URLSearchParams(window.location.search).get('state');
    const forceSaveError = new URLSearchParams(window.location.search).get('save') === 'error';
    const regions = $$('[data-outline-state]');
    const stored = readPptOutline();
    let timer = null;
    let failedOnce = false;

    function setState(state) {
      regions.forEach((region) => { region.hidden = region.dataset.outlineState !== state; });
    }
    function setSaveStatus(copy, error = false) {
      saveRegions.forEach((region) => {
        region.textContent = copy;
        region.classList.toggle('error', error);
        if (error) {
          region.setAttribute('role', 'button');
          region.setAttribute('tabindex', '0');
          region.setAttribute('aria-label', '保存失败，点击重试');
        } else {
          region.removeAttribute('role');
          region.removeAttribute('tabindex');
          region.removeAttribute('aria-label');
        }
      });
    }
    function saveNow() {
      const slides = readOutlineDocument(documentRoot);
      safeStorage.setItem(PPT_OUTLINE_KEY, JSON.stringify({ slides, active: 0 }));
      return slides;
    }
    function markDirty() {
      invalidateOutlineConfirmation();
      saveNow();
      setSaveStatus('保存中');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (forceSaveError && !failedOnce) {
          failedOnce = true;
          setSaveStatus('保存失败 · 重试', true);
          return;
        }
        setSaveStatus('已保存');
      }, 650);
    }
    function retrySave() {
      saveNow();
      setSaveStatus('保存中');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSaveStatus('已保存'), 500);
    }

    renderOutlineDocument(documentRoot, stored.slides);
    documentRoot.addEventListener('input', markDirty);
    documentRoot.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-outline-page]');
      if (!button) return;
      const pages = $$('[data-outline-page]', documentRoot);
      if (pages.length <= 1) return showToast('大纲至少保留一页');
      button.closest('[data-outline-page]')?.remove();
      renderOutlineDocument(documentRoot, readOutlineDocument(documentRoot));
      markDirty();
    });
    $('[data-add-outline-page]')?.addEventListener('click', () => {
      const slides = readOutlineDocument(documentRoot);
      slides.push(['未命名页面', '在这里补充本页要点。', '']);
      renderOutlineDocument(documentRoot, slides);
      markDirty();
      $('[data-outline-page]:last-child [data-outline-title]', documentRoot)?.focus();
    });
    saveRegions.forEach((region) => {
      region.addEventListener('click', () => { if (region.classList.contains('error')) retrySave(); });
      region.addEventListener('keydown', (event) => {
        if (region.classList.contains('error') && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          retrySave();
        }
      });
    });
    function regenerate() {
      invalidateOutlineConfirmation();
      setState('loading');
      window.setTimeout(() => {
        renderOutlineDocument(documentRoot, PPT_DEFAULT_SLIDES.map((slide) => [...slide]));
        saveNow();
        setSaveStatus('已保存');
        setState('content');
      }, 600);
    }
    $('[data-regenerate-outline]')?.addEventListener('click', regenerate);
    $('[data-outline-retry]')?.addEventListener('click', regenerate);
    $('[data-outline-return]')?.addEventListener('click', () => setState('content'));
    $$('[data-confirm-outline]').forEach((button) => button.addEventListener('click', () => {
      const slides = saveNow();
      if (!slides.length || saveRegions.some((region) => region.classList.contains('error'))) return showToast('请先保存大纲再继续');
      safeStorage.setItem(PPT_OUTLINE_CONFIRMED_KEY, 'true');
      const params = new URLSearchParams(window.location.search);
      const target = new URL('laoji-ppt-preview.html', window.location.href);
      ['conversation', 'from', 'book'].forEach((key) => { if (params.get(key)) target.searchParams.set(key, params.get(key)); });
      navigateTo(`${target.pathname.split('/').pop()}${target.search}`);
    }));
    setState(['loading', 'error'].includes(forcedState) ? forcedState : 'content');
  }

  function createPptSlideFrame(slide, index) {
    const frame = document.createElement('div');
    frame.className = `ppt-slide-frame${index === 0 ? ' ppt-slide-cover' : ''}`;
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = index === 0 ? '原子习惯' : `第 ${index + 1} 页`;
    const title = document.createElement('h3');
    title.textContent = slide[0];
    const copy = document.createElement('p');
    copy.textContent = slide[1];
    frame.append(eyebrow, title, copy);
    return frame;
  }

  function renderPptWaterfall(container, outline, record, mode = 'preview') {
    if (!container) return;
    const total = outline.slides.length;
    const completed = Math.max(0, Math.min(Number(record?.completedPages) || 0, total));
    const current = Math.max(1, Math.min(Number(record?.currentPage) || completed + 1, total));
    container.replaceChildren(...outline.slides.map((slide, index) => {
      const pageNumber = index + 1;
      let state = 'ready';
      if (mode === 'complete' || record?.status === 'completed') state = 'complete';
      else if (mode !== 'preview') state = pageNumber <= completed ? 'complete' : pageNumber === current ? 'current' : 'waiting';
      const article = document.createElement('article');
      article.className = 'ppt-page-card';
      article.dataset.pptPage = '';
      article.dataset.pptPageState = state;
      const label = document.createElement('div');
      label.className = 'ppt-page-label';
      const number = document.createElement('span');
      number.className = 'data';
      number.textContent = String(pageNumber).padStart(2, '0');
      const status = document.createElement('span');
      status.textContent = state === 'complete' ? '已完成' : state === 'current' ? `第 ${pageNumber} 页生成中` : state === 'waiting' ? '等待生成' : '预览';
      label.append(number, status);
      article.append(label);
      if (state === 'current') {
        const skeleton = document.createElement('div');
        skeleton.className = 'ppt-slide-skeleton';
        skeleton.setAttribute('aria-label', `第 ${pageNumber} 页生成中`);
        skeleton.innerHTML = '<span></span><span></span><span></span>';
        article.append(skeleton);
      } else if (state === 'waiting') {
        const waiting = document.createElement('div');
        waiting.className = 'ppt-waiting-page';
        const title = document.createElement('strong');
        title.textContent = slide[0];
        const copy = document.createElement('span');
        copy.textContent = '等待生成';
        waiting.append(title, copy);
        article.append(waiting);
      } else {
        const frame = createPptSlideFrame(slide, index);
        if (record?.template) frame.dataset.template = record.template;
        article.append(frame);
      }
      return article;
    }));
  }

  function getBookPageForRecord(bookId) {
    if (bookId === 'weread-atomic-habits') return 'laoji-wechat-book.html?view=ppt';
    if (bookId === 'local-thinking') return 'laoji-pdf-reader.html?view=ppt';
    return 'laoji-epub-reader.html?view=ppt';
  }

  function getPptRecordHref(record) {
    const params = new URLSearchParams({ from: 'book', book: record.bookId, record: record.id });
    return `laoji-ppt-preview.html?${params}`;
  }

  function createBookPptCover(record, visualStatus) {
    const template = ['business', 'cards', 'story'].includes(record.template) ? record.template : 'business';
    const cover = document.createElement('div');
    cover.className = `ppt-record-cover ppt-record-cover-${visualStatus} ppt-template-cover ppt-template-${template}`;
    cover.dataset.pptRecordTemplate = template;
    cover.setAttribute('aria-hidden', 'true');

    if (template === 'cards') {
      const number = document.createElement('span');
      number.className = 'ppt-template-number';
      number.textContent = String(record.totalPages || 1).padStart(2, '0');
      const title = document.createElement('span');
      title.className = 'ppt-template-title';
      title.textContent = record.title;
      const card = document.createElement('span');
      card.className = 'ppt-template-card';
      card.textContent = '观点 · 方法 · 行动';
      cover.append(number, title, card);
    } else if (template === 'story') {
      const image = document.createElement('span');
      image.className = 'ppt-template-image';
      image.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
      const copy = document.createElement('span');
      copy.className = 'ppt-template-copy';
      const kicker = document.createElement('span');
      kicker.className = 'ppt-template-kicker';
      kicker.textContent = record.bookTitle || '读书分享';
      const title = document.createElement('span');
      title.className = 'ppt-template-title';
      title.textContent = record.title;
      copy.append(kicker, title);
      cover.append(image, copy);
    } else {
      const kicker = document.createElement('span');
      kicker.className = 'ppt-template-kicker';
      kicker.textContent = (record.bookTitle || '读书分享').toUpperCase();
      const title = document.createElement('span');
      title.className = 'ppt-template-title';
      title.textContent = record.title;
      const rule = document.createElement('span');
      rule.className = 'ppt-template-rule';
      const meta = document.createElement('span');
      meta.className = 'ppt-template-meta';
      meta.textContent = `${record.totalPages || 1} 页 · 读书分享`;
      cover.append(kicker, title, rule, meta);
    }

    if (visualStatus !== 'completed') {
      const state = document.createElement('span');
      state.className = 'ppt-record-cover-state';
      if (visualStatus === 'failed') state.textContent = `已完成 ${record.completedPages || 0} / ${record.totalPages} 页`;
      else if (record.status === 'finalizing') state.textContent = '正在完成文件';
      else state.textContent = `第 ${record.currentPage} / ${record.totalPages} 页生成中`;
      cover.append(state);
    }
    return cover;
  }

  function createBookPptCard(record) {
    const isGenerating = ['generating', 'finalizing'].includes(record.status);
    const visualStatus = isGenerating ? 'generating' : record.status;
    const article = document.createElement('article');
    article.className = `card entity-card ppt-record-card ppt-record-${visualStatus}`;
    article.dataset.pptRecordId = record.id;
    const cover = createBookPptCover(record, visualStatus);
    const body = document.createElement('div');
    body.className = 'ppt-record-body';
    const meta = document.createElement('span');
    meta.className = 'ppt-record-meta';
    if (record.status === 'generating') meta.textContent = `正在生成第 ${record.currentPage} / ${record.totalPages} 页`;
    if (record.status === 'finalizing') meta.textContent = '正在完成文件';
    if (record.status === 'failed') meta.textContent = `生成失败 · 已完成 ${record.completedPages} / ${record.totalPages} 页`;
    if (record.status === 'completed') meta.textContent = `${record.createdAt || '刚刚'} · ${record.totalPages} 页`;
    const title = document.createElement('h2');
    title.textContent = record.title;
    body.append(meta, title);
    if (record.status === 'generating' || record.status === 'finalizing') {
      const note = document.createElement('span');
      note.className = 'ppt-record-note';
      note.textContent = record.status === 'generating' ? '可离开，后台继续' : `已完成 ${record.completedPages} / ${record.totalPages} 页`;
      body.append(note);
    }
    const recordLink = document.createElement('a');
    recordLink.className = 'ppt-record-link';
    recordLink.href = getPptRecordHref(record);
    recordLink.setAttribute('aria-label', `${meta.textContent}，${record.title}`);
    recordLink.append(cover, body);
    article.append(recordLink);
    if (record.status === 'failed') {
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const resume = document.createElement('a');
      resume.className = 'btn btn-primary';
      resume.href = getPptRecordHref(record);
      resume.textContent = '继续';
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost ppt-record-delete';
      remove.type = 'button';
      remove.dataset.deletePptRecord = record.id;
      remove.textContent = '删除';
      actions.append(resume, remove);
      article.append(actions);
    }
    return article;
  }

  function renderBookPptLists() {
    const state = window.LaojiState;
    if (!state) return;
    state.seed();
    $$('[data-book-ppt-list]').forEach((list) => {
      const panel = list.closest('[data-book-ppt-panel]');
      const bookId = document.body.dataset.bookId;
      const empty = $('[data-book-empty="ppt"]', panel);
      const error = $('[data-book-ppt-error]', panel);
      const forcedError = new URLSearchParams(window.location.search).get('ppt') === 'error';
      if (forcedError) {
        list.hidden = true;
        if (empty) empty.hidden = true;
        if (error) error.hidden = false;
        return;
      }
      const order = { generating: 0, finalizing: 0, failed: 1, completed: 2 };
      const records = state.listPptRecords(bookId)
        .filter((record) => ['generating', 'finalizing', 'failed', 'completed'].includes(record.status))
        .sort((a, b) => order[a.status] - order[b.status]);
      list.replaceChildren(...records.map(createBookPptCard));
      list.hidden = records.length === 0;
      if (empty) empty.hidden = records.length > 0;
      if (error) error.hidden = true;
    });
  }

  function initBookPptLists() {
    renderBookPptLists();
    $$('[data-book-ppt-retry]').forEach((button) => button.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('ppt');
      window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
      renderBookPptLists();
    }));
    document.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-delete-ppt-record]');
      if (remove) {
        window.LaojiState?.removePptRecord(remove.dataset.deletePptRecord);
        renderBookPptLists();
        showToast('生成任务已删除');
      }
      if (event.target.closest('[data-download-ppt-record]')) showToast('PPTX 已开始下载');
    });
  }

  function initPreview() {
    const canvas = $('[data-preview-canvas]');
    if (!canvas) return;
    const state = window.LaojiState;
    state?.seed();
    const params = new URLSearchParams(window.location.search);
    const forcedState = params.get('state');
    const entry = params.get('from') === 'book' ? 'book' : 'conversation';
    const bookId = params.get('book') || document.body.dataset.pptBookId || 'weread-atomic-habits';
    let pptConversation = ensurePptConversation({ id: getPptConversationId(params), bookId, entry, stage: 'template' });
    let currentRecord = state?.getPptRecord(params.get('record')) || null;
    const draftOutline = readPptOutline();
    const hasRecordOutline = Array.isArray(currentRecord?.outlineSnapshot) && currentRecord.outlineSnapshot.length;
    const outline = hasRecordOutline
      ? { slides: currentRecord.outlineSnapshot.map((slide) => [...slide]), active: 0 }
      : draftOutline;
    if (currentRecord && !hasRecordOutline) currentRecord = state?.updatePptTask(currentRecord.id, { outlineSnapshot: outline.slides.map((slide) => [...slide]) }) || currentRecord;
    const totalPages = outline.slides.length;
    const bookTitle = currentRecord?.bookTitle || state?.listLibraryBooks().find((book) => book.id === bookId)?.title || document.body.dataset.pptBookTitle || '原子习惯';
    const templates = $$('[data-template]', canvas);
    const regions = $$('[data-preview-state]', canvas);
    const statusRegions = $$('[data-generation-status]');
    const generateButtons = $$('[data-generate-ppt]', canvas);
    const savedTemplate = safeStorage.getItem('laoji-ppt-template');
    let selectedTemplate = currentRecord?.template || savedTemplate || $('[data-template].is-active', canvas)?.dataset.template || 'business';
    let timer = null;
    let finalizingTimer = null;

    function setPreviewState(nextState) {
      const visibleState = nextState === 'finalizing' ? 'generating' : nextState;
      regions.forEach((region) => { region.hidden = region.dataset.previewState !== visibleState; });
      const record = currentRecord;
      const statusCopy = nextState === 'ready'
        ? '选择模板'
        : nextState === 'generating'
          ? `正在生成第 ${record.currentPage} / ${record.totalPages} 页`
          : nextState === 'finalizing'
            ? '正在完成文件'
          : nextState === 'error'
            ? `生成失败 · ${record.completedPages} / ${record.totalPages} 页`
            : '已完成';
      statusRegions.forEach((region) => { region.textContent = statusCopy; });
      const conversationStatus = $('[data-ppt-conversation-status]');
      const conversationProgress = $('[data-ppt-conversation-progress]');
      const conversationTask = $('[data-ppt-conversation-task]');
      const conversationAction = $('[data-ppt-view="artifact"]', conversationTask);
      const headingCopy = nextState === 'ready'
        ? '模板与生成'
        : nextState === 'generating'
          ? '正在生成 PPT'
          : nextState === 'finalizing'
            ? '正在完成文件'
            : nextState === 'error'
              ? '生成失败'
              : 'PPT 已完成';
      $('[data-preview-heading]')?.replaceChildren(headingCopy);
      $$('[data-preview-ready-actions]').forEach((actions) => { actions.hidden = nextState !== 'ready'; });
      if (conversationStatus) conversationStatus.textContent = nextState === 'ready' ? '当前步骤 · 待选择模板' : nextState === 'complete' ? '当前步骤 · PPT 已完成' : nextState === 'error' ? '当前步骤 · 生成失败' : '当前步骤 · 生成任务';
      if (conversationProgress) conversationProgress.textContent = nextState === 'ready' ? `${totalPages} 页 · 待选择模板` : statusCopy;
      if (conversationTask) conversationTask.dataset.pptStage = nextState === 'ready' ? 'template' : nextState;
      if (conversationAction) conversationAction.textContent = nextState === 'ready' ? '选择模板' : nextState === 'complete' ? '打开 PPT' : nextState === 'error' ? '继续生成' : '查看生成进度';
      if (nextState === 'generating' || nextState === 'finalizing') {
        $('[data-preview-state-title]')?.replaceChildren(statusCopy);
        renderPptWaterfall($('[data-waterfall-mode="generation"]'), outline, record, 'generation');
        $('[data-generation-phase]')?.replaceChildren(nextState === 'finalizing' ? '正在完成文件' : '页面生成');
        $('[data-generation-stage]')?.replaceChildren(nextState === 'finalizing' ? '正在完成文件' : '逐页生成');
      }
      if (nextState === 'error') {
        $('[data-preview-error-copy]')?.replaceChildren(`已完成 ${record.completedPages} / ${record.totalPages} 页。大纲、模板和已完成页面均已保留。`);
        renderPptWaterfall($('[data-waterfall-mode="error"]'), outline, record, 'error');
      }
      if (nextState === 'complete') renderPptWaterfall($('[data-waterfall-mode="complete"]'), outline, record, 'complete');
      generateButtons.forEach((button) => { button.disabled = nextState !== 'ready'; });
      const conversationStage = nextState === 'ready' ? 'template' : nextState === 'error' ? 'failed' : nextState === 'complete' ? 'complete' : 'generating';
      pptConversation = state?.getPptConversation(pptConversation?.id) || pptConversation;
      if (pptConversation && pptConversation.stage !== conversationStage) {
        const stageMessages = {
          template: { id: 'template-ready', role: 'assistant', kind: 'stage', text: '大纲已确认，接下来选择模板。', status: 'complete' },
          generating: { id: 'generation-started', role: 'assistant', kind: 'stage', text: 'PPT 已开始逐页生成。', status: 'complete' },
          failed: { id: `generation-failed-${currentRecord?.id || 'current'}`, role: 'assistant', kind: 'stage', text: '生成失败，已完成页面和草稿均已保留。', status: 'failed' },
          complete: { id: `generation-complete-${currentRecord?.id || 'current'}`, role: 'assistant', kind: 'stage', text: 'PPT 已完成，可以预览或下载。', status: 'complete' }
        };
        pptConversation = advancePptConversation(pptConversation, conversationStage, stageMessages[conversationStage]) || pptConversation;
      }
      document.dispatchEvent(new CustomEvent('laoji:pptchange', { detail: record }));
    }

    function writeCurrentRecord(patch) {
      currentRecord = state?.updatePptTask(currentRecord.id, patch) || { ...currentRecord, ...patch };
      return currentRecord;
    }

    function bindConversationGenerationRun() {
      if (!pptConversation?.id || !currentRecord?.id) return;
      const latest = state?.getPptConversation(pptConversation.id) || pptConversation;
      pptConversation = state?.updatePptConversation(latest.id, {
        stage: 'generating',
        draft: { ...latest.draft, taskId: currentRecord.id }
      }, latest.revision) || latest;
    }

    function isCurrentConversationGenerationRun() {
      if (!pptConversation?.id || !currentRecord?.id) return true;
      const latest = state?.getPptConversation(pptConversation.id);
      return !latest || (latest.stage === 'generating' && latest.draft?.taskId === currentRecord.id);
    }

    function startPptGeneration(existingRecord = null) {
      window.clearInterval(timer);
      window.clearTimeout(finalizingTimer);
      if (existingRecord?.status === 'finalizing') {
        currentRecord = existingRecord;
        bindConversationGenerationRun();
        setPreviewState('finalizing');
        finalizingTimer = window.setTimeout(() => {
          if (!isCurrentConversationGenerationRun()) return;
          writeCurrentRecord({ status: 'completed' });
          setPreviewState('complete');
        }, 500);
        return;
      }
      if (existingRecord) {
        currentRecord = state.updatePptTask(existingRecord.id, { status: 'generating' });
      } else {
        currentRecord = state.createPptTask({
          bookId,
          bookTitle,
          title: outline.slides[0][0],
          template: selectedTemplate,
          totalPages,
          outlineSnapshot: outline.slides,
          entry
        });
        const url = new URL(window.location.href);
        url.searchParams.set('record', currentRecord.id);
        window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      bindConversationGenerationRun();
      setPreviewState('generating');
      timer = window.setInterval(() => {
        if (!isCurrentConversationGenerationRun()) {
          window.clearInterval(timer);
          timer = null;
          return;
        }
        if (!currentRecord || currentRecord.status !== 'generating') return;
        const completedPages = Math.min(currentRecord.totalPages, currentRecord.completedPages + 1);
        if (completedPages < currentRecord.totalPages) {
          writeCurrentRecord({ completedPages, currentPage: completedPages + 1 });
          setPreviewState('generating');
          return;
        }
        window.clearInterval(timer);
        timer = null;
        writeCurrentRecord({ completedPages, currentPage: currentRecord.totalPages, status: 'finalizing' });
        setPreviewState('finalizing');
        finalizingTimer = window.setTimeout(() => {
          if (!isCurrentConversationGenerationRun()) return;
          writeCurrentRecord({ status: 'completed' });
          setPreviewState('complete');
        }, 500);
      }, 650);
    }

    function applyTemplate(template) {
      selectedTemplate = template;
      safeStorage.setItem('laoji-ppt-template', template);
      templates.forEach((item) => {
        const active = item.dataset.template === template;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      $$('[data-waterfall-mode="preview"] .ppt-slide-frame').forEach((frame) => { frame.dataset.template = template; });
      const templateNames = { business: '简洁商务', cards: '知识卡片', story: '图文叙事' };
      const sourceCover = $(`[data-template="${template}"] [data-template-cover]`, canvas);
      $$('[data-current-template-cover]', canvas).forEach((cover) => {
        if (!sourceCover) return;
        cover.className = sourceCover.className;
        cover.dataset.currentTemplateCover = '';
        cover.replaceChildren(...Array.from(sourceCover.childNodes, (node) => node.cloneNode(true)));
      });
      $$('[data-current-template-name]', canvas).forEach((name) => { name.textContent = templateNames[template] || templateNames.business; });
    }
    renderPptWaterfall($('[data-waterfall-mode="preview"]'), outline, null, 'preview');
    applyTemplate(selectedTemplate);
    templates.forEach((button) => button.addEventListener('click', () => applyTemplate(button.dataset.template)));
    generateButtons.forEach((button) => button.addEventListener('click', () => startPptGeneration()));
    $$('[data-preview-retry]').forEach((button) => button.addEventListener('click', () => startPptGeneration(currentRecord)));
    $$('[data-delete-ppt-task]').forEach((button) => button.addEventListener('click', () => {
      if (currentRecord) state?.removePptRecord(currentRecord.id);
      currentRecord = null;
      const url = new URL(window.location.href);
      url.searchParams.delete('record');
      url.searchParams.delete('state');
      window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
      setPreviewState('ready');
    }));
    $$('[data-download]').forEach((button) => button.addEventListener('click', () => showToast('PPTX 已开始下载')));
    $$('[data-create-draft-from-work]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.createDraftFromWork;
      const sourceSlides = Array.isArray(currentRecord?.outlineSnapshot) && currentRecord.outlineSnapshot.length
        ? currentRecord.outlineSnapshot.map((slide) => [...slide])
        : outline.slides.map((slide) => [...slide]);
      safeStorage.setItem(PPT_OUTLINE_KEY, JSON.stringify({ slides: sourceSlides, active: 0 }));
      currentRecord = null;
      const url = new URL(window.location.href);
      url.searchParams.delete('record');
      url.searchParams.delete('state');
      window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
      if (action === 'outline') {
        invalidateOutlineConfirmation();
        const target = new URL('laoji-ppt-outline.html', window.location.href);
        if (entry === 'book') target.searchParams.set('from', 'book');
        target.searchParams.set('book', bookId);
        navigateTo(`${target.pathname.split('/').pop()}${target.search}`);
        return;
      }
      safeStorage.setItem(PPT_OUTLINE_CONFIRMED_KEY, 'true');
      setPreviewState('ready');
      showToast(action === 'template' ? '已创建新的模板草稿' : '已创建新的生成草稿');
    }));
    $$('[data-ppt-return]').forEach((button) => {
      button.textContent = entry === 'book' ? '返回读书 PPT' : '返回对话';
      button.addEventListener('click', () => {
        if (entry === 'book') navigateTo(getBookPageForRecord(bookId));
        else setPptMobileView($('[data-ppt-chat-shell]'), 'chat');
      });
    });
    if (forcedState === 'error') {
      currentRecord = currentRecord || state?.listPptRecords(bookId).find((record) => record.status === 'failed') || state?.createPptTask({ bookId, bookTitle, title: outline.slides[0][0], template: selectedTemplate, totalPages, outlineSnapshot: outline.slides, entry });
      if (currentRecord.status !== 'failed') currentRecord = state.updatePptTask(currentRecord.id, { status: 'failed', completedPages: Math.max(1, totalPages - 2), currentPage: Math.max(2, totalPages - 1) });
      setPreviewState('error');
    } else if (currentRecord?.status === 'completed') setPreviewState('complete');
    else if (currentRecord?.status === 'failed') setPreviewState('error');
    else if (currentRecord?.status === 'generating' || currentRecord?.status === 'finalizing') startPptGeneration(currentRecord);
    else setPreviewState('ready');

    window.requestAnimationFrame(() => {
      if (currentRecord) canvas.scrollTop = Math.max(0, Number(currentRecord.previewScrollTop) || 0);
    });
    let scrollSaveTimer = null;
    canvas.addEventListener('scroll', () => {
      if (!currentRecord) return;
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = window.setTimeout(() => {
        currentRecord = state?.updatePptTask(currentRecord.id, { previewScrollTop: Math.round(canvas.scrollTop) }) || currentRecord;
      }, 120);
    }, { passive: true });
    window.addEventListener('pagehide', () => {
      if (currentRecord) state?.updatePptTask(currentRecord.id, { previewScrollTop: Math.round(canvas.scrollTop) });
    });
  }

  function initSetupForms() {
    const params = new URLSearchParams(window.location.search);
    const safeReturn = resolveSettingsReturnTarget(params.get('return'));
    applySetupReturnLinks(safeReturn);
    $$('[data-setup-form]').forEach((form) => {
      const kind = form.dataset.setupForm;
      const section = form.closest('.settings-section');
      const summary = $('[data-connection-summary]', section);
      const invalid = $('[data-connection-invalid]', section);
      const status = $('[data-connection-status]', section);
      const invalidReason = $('[data-connection-invalid-reason]', section);

      function getConnection() {
        return window.LaojiState?.getConnection(kind) || (kind === 'ai' ? 'unconfigured' : 'disconnected');
      }

      function setConnection(value) {
        window.LaojiState?.setConnection(kind, value);
        if (kind === 'ai') safeStorage.setItem('laoji-ai-configured', String(value === 'connected'));
        if (kind === 'weread') safeStorage.setItem('laoji-weread-connected', String(value === 'connected'));
      }

      function showForm() {
        form.hidden = false;
        summary.hidden = true;
        invalid.hidden = true;
      }

      function renderConnection(state = getConnection()) {
        const needsReconnect = ['invalid', 'limited', 'partial'].includes(state);
        const connected = ['connected', 'syncing'].includes(state);
        applyConnectionStatus([status, ...$$(`[data-connection-top-status="${kind}"]`)].filter(Boolean), state);
        form.hidden = connected || needsReconnect;
        summary.hidden = !connected;
        invalid.hidden = !needsReconnect;
        if (invalidReason) {
          invalidReason.textContent = state === 'limited'
            ? '暂时无法使用，请重新连接。'
            : state === 'partial'
              ? '有内容还未更新，请继续。'
                : kind === 'ai'
                  ? '请重新连接 AI 服务。'
                  : '请重新连接微信读书。';
        }
        if (kind === 'weread') {
          $$('[data-connection-retry]', section).forEach((button) => {
            button.textContent = state === 'partial' ? '继续更新' : '重新连接';
          });
        }
      }

      renderConnection();
      $$('[data-connection-edit], [data-connection-retry]', section).forEach((button) => button.addEventListener('click', () => {
        if (kind === 'weread' && button.hasAttribute('data-connection-retry') && getConnection() === 'partial') {
          navigateTo('laoji-library.html?sync=retry');
          return;
        }
        showForm();
        $('[data-secret-key]', form)?.focus();
      }));
      bindConnectionRevoke(document.getElementById(`${kind}-revoke-dialog`), kind, (nextState) => {
        setConnection(nextState);
        renderConnection(nextState);
        showForm();
        showToast(kind === 'ai' ? 'AI 服务已断开' : '微信读书已断开');
      });

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const key = $('[data-secret-key]', form);
        const error = $('[data-key-error]', form);
        const submit = $('button[type="submit"]', form);
        const value = key?.value.trim().toLowerCase() || '';
        const expired = value.includes('expired');
        if (!key || (key.value.trim().length < 8 && !expired)) {
          error.textContent = '请输入至少 8 个字符的有效密钥';
          key?.focus();
          return;
        }
        error.textContent = '';
        const previousConnection = getConnection();
        setConnection('validating');
        renderConnection('validating');
        submit.disabled = true;
        submit.textContent = '正在连接…';
        window.setTimeout(() => {
          if (expired) {
            setConnection('invalid');
            renderConnection('invalid');
            submit.disabled = false;
            submit.textContent = kind === 'ai' ? '连接 AI 服务' : '连接微信读书';
            return;
          }
          if (value.includes('fail')) {
            setConnection(previousConnection);
            showForm();
            applyConnectionStatus([status, ...$$(`[data-connection-top-status="${kind}"]`)].filter(Boolean), previousConnection);
            error.textContent = '连接失败，请检查密钥后重试';
            submit.disabled = false;
            submit.textContent = kind === 'ai' ? '连接 AI 服务' : '连接微信读书';
            return;
          }
          setConnection('connected');
          renderConnection('connected');
          showToast(kind === 'ai' ? 'AI 服务已连接' : '微信读书已连接');
          window.setTimeout(() => { navigateTo(safeReturn || form.dataset.returnTo || 'laoji-settings.html'); }, 700);
        }, 700);
      });
    });
  }

  function initUtilityActions() {
    $$('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
  }

  function initBookPicker() {
    const picker = $('[data-book-picker], [data-mobile-book-picker]');
    if (!picker) return;
    const choices = $$('[data-book-choice]');
    const status = $('[data-book-choice-status]');
    const confirm = $('[data-confirm-book]');
    const shell = $('[data-ppt-chat-shell]');
    const workbench = $('[data-ppt-scope-workbench]', shell || document);
    const thread = $('[data-chat-thread]', shell || document);
    const mobileDialog = document.getElementById('mobile-book-picker-dialog');
    const mobileOpen = $('[data-mobile-book-picker-open]');
    const mobileTitle = $('[data-mobile-book-title]');
    const mobileAuthor = $('[data-mobile-book-author]');
    const mobileImage = $('.mobile-book-selector img');
    let selectedChoice = choices.find((choice) => choice.getAttribute('aria-pressed') === 'true') || choices[0];
    function createPptStageCard(stage, book) {
      const stageHost = $('[data-ppt-stage-host]', thread);
      if (!stageHost) return null;
      const card = document.createElement('section');
      card.className = 'ppt-stage-card';
      card.dataset.pptStageCard = '';
      card.dataset.pptStage = stage;
      card.setAttribute('aria-labelledby', `chat-ppt-${stage}-stage-title`);
      const copy = document.createElement('div');
      copy.className = 'ppt-stage-card-copy';
      const statusCopy = document.createElement('p');
      statusCopy.className = 'eyebrow';
      statusCopy.textContent = '当前步骤 · 待确认';
      const titleCopy = document.createElement('h2');
      titleCopy.id = `chat-ppt-${stage}-stage-title`;
      titleCopy.textContent = '确认 PPT 范围';
      const detailCopy = document.createElement('p');
      detailCopy.textContent = `《${book.title || '当前书籍'}》 · 整本书 · 标准 8 页`;
      const action = document.createElement('button');
      action.className = 'btn btn-primary';
      action.type = 'button';
      action.dataset.pptView = 'artifact';
      action.setAttribute('aria-expanded', 'false');
      action.textContent = '继续确认范围';
      action.addEventListener('click', () => setPptMobileView(shell, 'artifact'));
      copy.append(statusCopy, titleCopy, detailCopy);
      card.append(copy, action);
      stageHost.replaceChildren(card);
      return card;
    }
    function select(choice) {
      selectedChoice = choice;
      const title = choice.dataset.bookTitle || '当前书籍';
      choices.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.bookTitle === title)));
      if (status) status.textContent = `已选择《${title}》`;
      if (mobileTitle) mobileTitle.textContent = title;
      if (mobileAuthor) mobileAuthor.textContent = choice.dataset.bookAuthor || choice.querySelector('.cover-author')?.textContent || '';
      if (mobileImage) mobileImage.src = choice.dataset.bookCover || `assets/covers/${title === '原子习惯' ? 'atomic-habits' : title === '深度工作' ? 'deep-work' : title === '思考，快与慢' ? 'thinking-fast-and-slow' : 'courage-to-be-disliked'}.svg`;
      if (mobileDialog?.open) mobileDialog.close();
      safeStorage.setItem('laoji-ppt-selected-book', JSON.stringify({ title, author: choice.dataset.bookAuthor || '', cover: choice.dataset.bookCover || '' }));
    }
    choices.forEach((choice) => choice.addEventListener('click', () => select(choice)));
    mobileOpen?.addEventListener('click', () => mobileDialog?.showModal());
    function openScopeWorkbench(book) {
      if (!book || !shell || !workbench || !thread) return;
      const title = book.title || '当前书籍';
      const author = book.author || '';
      const cover = book.cover || '';
      let conversation = ensurePptConversation({
        id: document.body.dataset.pptConversationId || `ppt-conversation-${title === '原子习惯' ? 'atomic-habits' : title}`,
        title: `把《${title}》做成读书分享 PPT`,
        bookId: title === '原子习惯' ? 'weread-atomic-habits' : undefined,
        bookTitle: title,
        stage: 'scope'
      });
      conversation = appendPptConversationMessage(conversation, {
        id: `book-selected-${conversation?.bookId || title}`,
        role: 'user',
        kind: 'book-selection',
        text: `使用《${title}》制作 PPT。`,
        status: 'complete'
      }) || conversation;
      conversation = appendPptConversationMessage(conversation, {
        id: `scope-ready-${conversation?.bookId || title}`,
        role: 'assistant',
        kind: 'stage',
        text: `已选择《${title}》，接下来确认内容范围。`,
        status: 'complete'
      }) || conversation;
      renderPptConversationTimeline($('[data-ppt-conversation-timeline]', shell), conversation?.messages || []);
      safeStorage.setItem('laoji-ppt-selected-book', JSON.stringify({ title, author, cover }));
      if (!$('[data-chat-book-confirmation]', thread)) {
        const userRow = document.createElement('div');
        userRow.className = 'message-row user';
        userRow.dataset.chatBookConfirmation = '';
        userRow.innerHTML = '<span class="message-mark">你</span><div class="message-bubble"><p></p></div>';
        $('p', userRow).textContent = `使用《${title}》制作 PPT。`;
        const selectedBook = document.createElement('div');
        selectedBook.className = 'ppt-selected-book-inline';
        const selectedCover = document.createElement('img');
        selectedCover.alt = '';
        selectedCover.src = cover;
        const selectedCopy = document.createElement('span');
        const selectedTitle = document.createElement('strong');
        selectedTitle.textContent = title;
        const selectedAuthor = document.createElement('small');
        selectedAuthor.textContent = author;
        const selectedStatus = document.createElement('small');
        selectedStatus.className = 'ppt-selected-status';
        selectedStatus.textContent = '已选择';
        selectedCopy.append(selectedTitle, selectedAuthor);
        selectedBook.append(selectedCover, selectedCopy, selectedStatus);
        $('.message-bubble', userRow).append(selectedBook);
        const assistantRow = document.createElement('div');
        assistantRow.className = 'message-row assistant';
        assistantRow.innerHTML = `<span class="message-mark"><img src="${DEFAULT_AVATAR}" alt="老己"></span><div class="message-bubble"><p>书籍已锁定。下一步确认内容范围和分享方式，我会据此生成可编辑大纲。</p></div>`;
        thread.append(userRow, assistantRow);
        const stageHost = $('[data-ppt-stage-host]', thread);
        if (stageHost) thread.append(stageHost);
      }
      createPptStageCard('scope', book);
      $('[data-scope-book-title]', workbench)?.replaceChildren(title);
      $('[data-scope-book-author]', workbench)?.replaceChildren(author);
      const workbenchCover = $('[data-scope-book-cover]', workbench);
      if (workbenchCover && cover) workbenchCover.src = cover;
      const pickerMessage = confirm.closest('.message-row');
      if (pickerMessage) pickerMessage.hidden = true;
      workbench.hidden = false;
      setPptWorkbenchOpen(shell, true);
      shell.classList.add('has-scope-workbench');
      if (window.matchMedia('(max-width: 767px)').matches) setPptMobileView(shell, 'artifact');
      const feed = $('[data-chat-feed]', shell);
      if (feed) feed.scrollTop = feed.scrollHeight;
      $('[data-ppt-choice-group] button', workbench)?.focus();
      safeStorage.setItem('laoji-ppt-chat-scope-open', 'true');
    }
    confirm?.addEventListener('click', (event) => {
      event.preventDefault();
      if (!selectedChoice) return;
      openScopeWorkbench({
        title: selectedChoice.dataset.bookTitle,
        author: selectedChoice.dataset.bookAuthor,
        cover: selectedChoice.dataset.bookCover
      });
    });
    if (safeStorage.getItem('laoji-ppt-chat-scope-open') === 'true' && shell && workbench && thread) {
      try {
        const savedBook = JSON.parse(safeStorage.getItem('laoji-ppt-selected-book') || 'null');
        if (savedBook?.title) openScopeWorkbench(savedBook);
      } catch (_) { /* Keep the book picker available when its saved context is invalid. */ }
    }
  }

  function setPptMobileView(shell, nextView) {
    if (!shell) return;
    const view = nextView === 'artifact' ? 'artifact' : 'chat';
    const chatFeed = $('[data-chat-feed]', shell);
    const artifactCanvas = $('.ppt-artifact-canvas', shell);
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (view === 'artifact' && isPptSingleTaskViewport() && artifactCanvas?.hidden) {
      setPptWorkbenchOpen(shell, true);
    }
    if (view === 'chat' && window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches && shell.dataset.workbenchOpen === 'true') {
      setPptWorkbenchOpen(shell, false);
    }
    if (view === 'artifact') {
      shell.dataset.chatScrollTop = String(chatFeed?.scrollTop || 0);
      if (document.activeElement instanceof HTMLElement && shell.contains(document.activeElement)) {
        shell._pptArtifactTrigger = document.activeElement;
      }
    }
    shell.dataset.mobileView = view;
    document.body.classList.toggle('ppt-artifact-open', view === 'artifact');
    if (artifactCanvas) {
      if (isMobile) {
        artifactCanvas.toggleAttribute('inert', view !== 'artifact');
        artifactCanvas.setAttribute('aria-hidden', String(view !== 'artifact'));
      } else {
        artifactCanvas.removeAttribute('inert');
        artifactCanvas.removeAttribute('aria-hidden');
      }
    }
    if (isMobile) {
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
      window.requestAnimationFrame(() => window.scrollTo(0, window.scrollY));
    }
    $$('[data-ppt-view]').forEach((button) => {
      const opensArtifact = button.dataset.pptView === 'artifact';
      button.setAttribute('aria-expanded', String(opensArtifact && view === 'artifact'));
    });
    if (view === 'chat' && chatFeed) {
      const savedScrollTop = Number(shell.dataset.chatScrollTop || 0);
      window.requestAnimationFrame(() => {
        chatFeed.scrollTop = savedScrollTop;
        if (shell._pptArtifactTrigger?.isConnected) shell._pptArtifactTrigger.focus();
      });
    } else if (view === 'artifact' && isMobile && artifactCanvas) {
      window.requestAnimationFrame(() => {
        const firstControl = $('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])', artifactCanvas);
        firstControl?.focus();
      });
    }
  }

  function isPptSingleTaskViewport() {
    return window.matchMedia('(max-width: 1023px)').matches;
  }

  function getPptConversationId(params = new URLSearchParams(window.location.search)) {
    return params.get('conversation')
      || document.body.dataset.pptConversationId
      || `ppt-conversation-${document.body.dataset.pptBookId || 'atomic-habits'}`;
  }

  function ensurePptConversation(seed = {}) {
    const state = window.LaojiState;
    if (!state) return null;
    const id = seed.id || getPptConversationId();
    const existing = state.getPptConversation(id);
    if (existing) return existing;
    return state.upsertPptConversation({
      id,
      title: seed.title || '习惯系统分享',
      bookId: seed.bookId || document.body.dataset.pptBookId || 'weread-atomic-habits',
      bookTitle: seed.bookTitle || document.body.dataset.pptBookTitle || '原子习惯',
      entry: seed.entry === 'book' ? 'book' : 'conversation',
      stage: seed.stage || 'scope',
      messages: [],
      draft: seed.draft || {}
    });
  }

  function appendPptConversationMessage(conversation, message) {
    const state = window.LaojiState;
    if (!state || !conversation?.id || !message?.id) return conversation || null;
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    if (messages.some((item) => item.id === message.id)) return conversation;
    return state.updatePptConversation(conversation.id, { messages: [...messages, message] }, conversation.revision);
  }

  function advancePptConversation(conversation, stage, message) {
    const state = window.LaojiState;
    if (!state || !conversation?.id) return null;
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const nextMessages = message?.id && !messages.some((item) => item.id === message.id)
      ? [...messages, message]
      : messages;
    return state.updatePptConversation(conversation.id, { stage, messages: nextMessages }, conversation.revision);
  }

  function propagatePptConversationRoute(link, conversation) {
    if (!link || !conversation?.id) return link;
    const target = new URL(link.getAttribute('href'), window.location.href);
    const params = target.searchParams;
    params.set('conversation', conversation.id);
    const current = new URLSearchParams(window.location.search);
    ['from', 'book'].forEach((key) => { if (current.get(key)) params.set(key, current.get(key)); });
    link.href = `${target.pathname.split('/').pop()}${target.search}${target.hash}`;
    return link;
  }

  function renderPptConversationTimeline(host, messages) {
    if (!host || !Array.isArray(messages)) return;
    let timeline = $('[data-ppt-persisted-messages]', host);
    if (!timeline) {
      timeline = document.createElement('div');
      timeline.dataset.pptPersistedMessages = '';
      const thread = $('.chat-thread', host) || host;
      thread.prepend(timeline);
    }
    const existing = new Set($$('[data-ppt-message-id]', timeline).map((row) => row.dataset.pptMessageId));
    messages.forEach((message) => {
      if (!message?.id || existing.has(message.id)) return;
      const row = document.createElement('div');
      row.className = `message-row ${message.role === 'user' ? 'user' : 'assistant'}`;
      row.dataset.pptMessageId = message.id;
      const mark = document.createElement('span');
      mark.className = 'message-mark';
      mark.textContent = message.role === 'user' ? '你' : '己';
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      const text = document.createElement('p');
      text.textContent = message.text || '';
      bubble.append(text);
      row.append(mark, bubble);
      timeline.append(row);
      existing.add(message.id);
    });
  }

  function setPptSessionMode(shell, mode) {
    if (!shell) return;
    const root = shell.closest('.app-shell') || document;
    const panel = $('[data-ppt-session-panel]', shell);
    const button = $('[data-ppt-session-toggle]', root);
    const closeButton = $('[data-ppt-session-close]', panel || shell);
    mode = ['pinned', 'overlay'].includes(mode) ? mode : 'collapsed';
    const expanded = mode !== 'collapsed';
    shell.dataset.sessionMode = mode;
    if (button) {
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', expanded ? '收起会话列表' : '展开会话列表');
      button.setAttribute('title', expanded ? '收起会话列表' : '展开会话列表');
    }
    if (closeButton) closeButton.hidden = !expanded;
    if (panel) {
      panel.hidden = !expanded;
      panel.toggleAttribute('inert', !expanded);
      panel.setAttribute('aria-hidden', String(!expanded));
    }
  }

  function setPptWorkbenchOpen(shell, isOpen) {
    if (!shell) return;
    const panel = $('[data-ppt-workbench-panel]', shell);
    const button = $('[data-ppt-workbench-toggle]', shell);
    const stageHost = $('[data-ppt-stage-host]', shell);
    const continuation = $('[data-ppt-stage-card]', stageHost || shell);
    const singleTask = isPptSingleTaskViewport();
    shell.dataset.workbenchOpen = String(isOpen);
    if (panel) panel.hidden = !isOpen;
    if (button) {
      button.setAttribute('aria-expanded', String(isOpen));
      button.setAttribute('aria-label', isOpen ? '收起作品工作台' : '展开作品工作台');
    }
    if (continuation) continuation.hidden = singleTask ? false : isOpen;
    if (stageHost) stageHost.hidden = !singleTask && isOpen;
  }

  function initPptDesktopShell(shell, conversation) {
    if (!shell) return null;
    const root = shell.closest('.app-shell') || document;
    const state = window.LaojiState;
    let currentConversation = conversation || null;
    const sessionButton = $('[data-ppt-session-toggle]', root);
    const sessionCloseButton = $('[data-ppt-session-close]', shell);
    const workbenchButton = $('[data-ppt-workbench-toggle]', shell);
    const initialSessionMode = isPptSingleTaskViewport()
      ? 'collapsed'
      : (currentConversation?.ui?.sessionListMode || shell.dataset.sessionMode || 'collapsed');
    const panelStartsOpen = !$('[data-ppt-workbench-panel]', shell)?.hidden;
    const initialWorkbenchOpen = typeof currentConversation?.ui?.workbenchOpen === 'boolean'
      ? currentConversation.ui.workbenchOpen
      : panelStartsOpen;

    function persistUi(patch) {
      if (!currentConversation?.id || !state?.updatePptConversation) return;
      const latest = state.getPptConversation(currentConversation.id) || currentConversation;
      const updated = state.updatePptConversation(latest.id, {
        ui: { ...latest.ui, ...patch }
      }, latest.revision);
      if (updated) currentConversation = updated;
    }

    setPptSessionMode(shell, initialSessionMode);
    setPptWorkbenchOpen(shell, initialWorkbenchOpen);

    sessionButton?.addEventListener('click', () => {
      const isExpanded = sessionButton.getAttribute('aria-expanded') === 'true';
      const nextMode = isExpanded ? 'collapsed' : (window.matchMedia('(min-width: 1280px)').matches ? 'pinned' : 'overlay');
      shell._pptSessionTrigger = sessionButton;
      setPptSessionMode(shell, nextMode);
      persistUi({ sessionListMode: nextMode });
      if (!isExpanded && nextMode === 'overlay') window.requestAnimationFrame(() => $('[data-ppt-session-panel] button, [data-ppt-session-panel] a', shell)?.focus());
    });

    sessionCloseButton?.addEventListener('click', () => {
      setPptSessionMode(shell, 'collapsed');
      persistUi({ sessionListMode: 'collapsed' });
      sessionButton?.focus();
    });

    workbenchButton?.addEventListener('click', () => {
      const nextOpen = workbenchButton.getAttribute('aria-expanded') !== 'true';
      setPptWorkbenchOpen(shell, nextOpen);
      persistUi({ workbenchOpen: nextOpen });
      if (!nextOpen) window.requestAnimationFrame(() => $('[data-ppt-stage-card] button, [data-ppt-stage-card] a', shell)?.focus());
    });

    shell.addEventListener('click', (event) => {
      const continuationButton = event.target.closest('[data-ppt-stage-card] [data-ppt-view="artifact"]');
      if (!continuationButton || isPptSingleTaskViewport()) return;
      setPptWorkbenchOpen(shell, true);
      persistUi({ workbenchOpen: true });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && shell.dataset.sessionMode === 'overlay') {
        setPptSessionMode(shell, 'collapsed');
        persistUi({ sessionListMode: 'collapsed' });
        (shell._pptSessionTrigger || sessionButton)?.focus();
      }
    });
    return currentConversation;
  }

  function initPptConversation() {
    const shell = $('[data-ppt-chat-shell]');
    if (!shell) return;
    document.documentElement.classList.add('ppt-conversation-root');
    const params = new URLSearchParams(window.location.search);
    const seededConversationId = getPptConversationId(params);
    let currentConversation = ensurePptConversation({ id: seededConversationId });
    initPptDesktopShell(shell, currentConversation);
    const contextRoot = shell.closest('.app-shell') || document;
    $$('a[href^="laoji-ppt-materials.html"], a[href^="laoji-ppt-outline.html"], a[href^="laoji-ppt-preview.html"]', contextRoot).forEach((link) => {
      propagatePptConversationRoute(link, currentConversation);
    });
    const timeline = $('[data-ppt-conversation-timeline]', shell);
    renderPptConversationTimeline(timeline, currentConversation?.messages || []);
    window.requestAnimationFrame(() => {
      const chatFeed = $('[data-chat-feed]', shell);
      const workbench = $('[data-ppt-workbench-panel]', shell);
      if (chatFeed) chatFeed.scrollTop = Math.min(Number(currentConversation?.ui?.chatScrollTop) || 0, Math.max(0, chatFeed.scrollHeight - chatFeed.clientHeight));
      if (workbench) workbench.scrollTop = Math.min(Number(currentConversation?.ui?.workbenchScrollTop) || 0, Math.max(0, workbench.scrollHeight - workbench.clientHeight));
    });
    function persistConversationUi() {
      if (!currentConversation?.id) return;
      const chatFeed = $('[data-chat-feed]', shell);
      const workbench = $('[data-ppt-workbench-panel]', shell);
      const latest = window.LaojiState?.getPptConversation(currentConversation.id) || currentConversation;
      const updated = window.LaojiState?.updatePptConversation(latest.id, {
        ui: {
          ...latest.ui,
          chatScrollTop: Math.round(chatFeed?.scrollTop || 0),
          workbenchScrollTop: Math.round(workbench?.scrollTop || 0)
        }
      }, latest.revision);
      if (updated) currentConversation = updated;
    }
    window.addEventListener('pagehide', persistConversationUi);
    document.addEventListener('click', (event) => {
      currentConversation = window.LaojiState?.getPptConversation(currentConversation?.id) || currentConversation;
      if (event.target.closest('[data-generate-outline]')) {
        currentConversation = window.LaojiState?.updatePptConversation(currentConversation.id, {
          draft: { ...currentConversation.draft, ...readMaterialDraft() }
        }, currentConversation.revision) || currentConversation;
        currentConversation = advancePptConversation(currentConversation, 'outline', { id: 'scope-confirmed', role: 'assistant', kind: 'stage', text: '范围已确认，正在生成可编辑大纲。', status: 'complete' }) || currentConversation;
      } else if (event.target.closest('[data-confirm-outline]')) {
        currentConversation = window.LaojiState?.updatePptConversation(currentConversation.id, {
          draft: { ...currentConversation.draft, outline: readPptOutline().slides }
        }, currentConversation.revision) || currentConversation;
        currentConversation = advancePptConversation(currentConversation, 'template', { id: 'outline-confirmed', role: 'assistant', kind: 'stage', text: '大纲已确认，接下来选择模板。', status: 'complete' }) || currentConversation;
      } else if (event.target.closest('[data-generate-ppt]')) {
        currentConversation = window.LaojiState?.updatePptConversation(currentConversation.id, {
          draft: { ...currentConversation.draft, template: safeStorage.getItem('laoji-ppt-template') || currentConversation.draft.template || 'business' }
        }, currentConversation.revision) || currentConversation;
        currentConversation = advancePptConversation(currentConversation, 'generating', { id: 'template-confirmed', role: 'assistant', kind: 'stage', text: '模板已确认，开始逐页生成 PPT。', status: 'complete' }) || currentConversation;
      }
      renderPptConversationTimeline(timeline, currentConversation?.messages || []);
    }, true);
    $$('[data-ppt-view]').forEach((button) => button.addEventListener('click', () => {
      setPptMobileView(shell, button.dataset.pptView);
    }));
    setPptMobileView(shell, shell.dataset.mobileView);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && shell.dataset.mobileView === 'artifact') {
        setPptMobileView(shell, 'chat');
      }
    });
    const scopeSummary = $('[data-ppt-scope-summary]');
    const scopeLabels = {
      'all-notes': '用我的笔记和老己笔记',
      chapters: '使用指定章节',
      'laoji-notes': '只用老己笔记'
    };
    function updateScopeSummary() {
      const selected = $('[data-ppt-scope-choice][aria-pressed="true"]', shell);
      if (scopeSummary && selected) scopeSummary.textContent = `${scopeLabels[selected.dataset.pptScopeChoice]}，${$('[data-friend-opinion]')?.checked ? '加入书友观点并保留来源' : '不加入书友观点'}。`;
    }
    $$('[data-ppt-scope-choice]', shell).forEach((button) => button.addEventListener('click', () => {
      $$('[data-ppt-scope-choice]', shell).forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      updateScopeSummary();
    }));
    $('[data-friend-opinion]')?.addEventListener('change', updateScopeSummary);
    updateScopeSummary();
    const inlineDraftKey = 'laoji-ppt-conversation-input-draft';
    $$('[data-ppt-inline-form]', shell).forEach((form) => {
      const input = $('[data-ppt-inline-input]', form);
      if (input) {
        input.value = safeStorage.getItem(inlineDraftKey) || input.value;
        resizeConversationInput(input);
        input.addEventListener('input', () => safeStorage.setItem(inlineDraftKey, input.value));
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!input?.value.trim()) return;
        currentConversation = window.LaojiState?.getPptConversation(currentConversation?.id) || currentConversation;
        currentConversation = appendPptConversationMessage(currentConversation, {
          id: `requirement-${Date.now()}`,
          role: 'user',
          kind: 'requirement',
          text: input.value.trim(),
          status: 'complete'
        }) || currentConversation;
        renderPptConversationTimeline(timeline, currentConversation?.messages || []);
        showToast('修改要求已加入当前 PPT 会话');
        input.value = '';
        safeStorage.removeItem(inlineDraftKey);
        resizeConversationInput(input);
      });
    });
  }

  function resizeConversationInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }

  function initConversationInputs() {
    $$('[data-chat-input], [data-ppt-inline-input]').forEach((input) => {
      resizeConversationInput(input);
      input.addEventListener('input', () => resizeConversationInput(input));
    });
  }

  function initLocalBookNotes() {
    $$('[data-local-note-list]').forEach((noteList) => {
      const notesPanel = noteList.closest('[data-book-notes-panel]');
      const emptyState = $('[data-local-notes-empty]', notesPanel);
      const dialog = $('[data-local-note-dialog]');
      const source = $('[data-local-note-source]', dialog);
      const editor = $('[data-local-note-editor]', dialog);

      function updateEmptyState() {
        const hasNotes = Boolean($('[data-local-note-card]', noteList));
        noteList.hidden = !hasNotes;
        if (emptyState) emptyState.hidden = hasNotes;
      }

      noteList.addEventListener('click', async (event) => {
        const card = event.target.closest('[data-local-note-card]');
        if (!card) return;
        const noteText = $('[data-note-copy-text]', card)?.textContent.trim() || '';

        if (event.target.closest('[data-note-copy]')) {
          try { await navigator.clipboard.writeText(noteText); }
          catch (_) { /* Restricted previews still provide visible toast feedback. */ }
        }

        if (event.target.closest('[data-note-edit]')) {
          const quote = $('.quote', card);
          if (source) {
            source.hidden = !quote;
            if (quote) source.textContent = quote.textContent.trim();
          }
          if (editor) editor.value = noteText;
        }

        if (event.target.closest('[data-note-delete]')) {
          card.remove();
          updateEmptyState();
        }
      });

      updateEmptyState();
    });
  }

  function initLocalReaderHighlightContext() {
    $$('[data-local-reader-workspace]').forEach((workspace) => {
      const highlights = $$('[data-local-reader-highlight]', workspace);
      const panel = $('[data-local-reader-context-panel]', workspace);
      const backdrop = $('[data-local-reader-context-backdrop]', workspace);
      const quote = $('[data-local-reader-context-quote]', panel);
      const noteList = $('[data-local-reader-context-note-list]', panel);
      const count = $('[data-local-reader-context-count]', panel);
      const closeButton = $('[data-local-reader-context-close]', panel);
      const addButton = $('[data-local-reader-context-add]', panel);
      const readingContent = $('.local-reader-content', workspace);
      const dialogId = addButton?.dataset.dialogOpen;
      const dialog = dialogId ? document.getElementById(dialogId) : null;
      const dialogSource = $('[data-local-note-source]', dialog);
      const dialogEditor = $('[data-local-note-editor]', dialog);
      let activeHighlight = null;

      if (!highlights.length || !panel || !backdrop || !quote || !noteList || !count) return;

      function readNotes(highlight) {
        try {
          const parsed = JSON.parse(highlight.dataset.localReaderHighlightNotes || '[]');
          return Array.isArray(parsed)
            ? parsed.filter((note) => note && typeof note.text === 'string' && note.text.trim())
            : [];
        } catch (_) {
          return [];
        }
      }

      function createNote(note) {
        const card = document.createElement('article');
        card.className = 'local-reader-context-note source-activatable';
        card.tabIndex = 0;
        card.dataset.localReaderContextNote = '';

        const time = document.createElement('time');
        time.textContent = typeof note.time === 'string' ? note.time : '';

        const copy = document.createElement('p');
        copy.dataset.localReaderContextNoteText = '';
        copy.textContent = note.text.trim();

        const tools = document.createElement('div');
        tools.className = 'source-tools source-action-popover';
        tools.setAttribute('role', 'toolbar');
        tools.setAttribute('aria-label', '这条想法的操作');

        const remove = document.createElement('button');
        remove.className = 'source-action';
        remove.type = 'button';
        remove.dataset.localReaderContextNoteDelete = '';
        remove.textContent = '删除';

        const edit = document.createElement('button');
        edit.className = 'source-action';
        edit.type = 'button';
        edit.dataset.localReaderContextNoteEdit = '';
        edit.textContent = '编辑';

        const duplicate = document.createElement('button');
        duplicate.className = 'source-action';
        duplicate.type = 'button';
        duplicate.dataset.localReaderContextNoteCopy = '';
        duplicate.textContent = '复制';

        tools.append(remove, edit, duplicate);
        card.append(time, copy, tools);
        return card;
      }

      function updateCount() {
        const total = $$('[data-local-reader-context-note]', noteList).length;
        count.textContent = `${total} 条`;
      }

      function render(highlight) {
        quote.textContent = highlight.dataset.localReaderHighlightQuote || highlight.textContent.trim();
        noteList.replaceChildren(...readNotes(highlight).map(createNote));
        updateCount();
      }

      function open(highlight) {
        activeHighlight = highlight;
        render(highlight);
        panel.hidden = false;
        backdrop.hidden = false;
        workspace.setAttribute('data-local-reader-context-open', '');
        highlights.forEach((item) => item.setAttribute('aria-expanded', String(item === highlight)));
      }

      function close({ restoreFocus = false } = {}) {
        workspace.removeAttribute('data-local-reader-context-open');
        panel.hidden = true;
        backdrop.hidden = true;
        highlights.forEach((item) => item.setAttribute('aria-expanded', 'false'));
        if (restoreFocus) activeHighlight?.focus();
      }

      highlights.forEach((highlight) => {
        highlight.addEventListener('click', () => open(highlight));
        highlight.addEventListener('keydown', (event) => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          open(highlight);
        });
      });

      addButton?.addEventListener('click', () => {
        if (!activeHighlight) return;
        if (dialogSource) {
          dialogSource.hidden = false;
          dialogSource.textContent = activeHighlight.dataset.localReaderHighlightQuote || activeHighlight.textContent.trim();
        }
        if (dialogEditor && addButton.dataset.localReaderContextEditing !== 'true') dialogEditor.value = '';
      });

      panel.addEventListener('click', async (event) => {
        const card = event.target.closest('[data-local-reader-context-note]');
        if (!card) return;
        const text = $('[data-local-reader-context-note-text]', card)?.textContent.trim() || '';

        if (event.target.closest('[data-local-reader-context-note-copy]')) {
          try { await navigator.clipboard.writeText(text); }
          catch (_) { /* Restricted previews still provide visible feedback. */ }
          showToast('想法已复制');
        }

        if (event.target.closest('[data-local-reader-context-note-delete]')) {
          card.remove();
          updateCount();
          showToast('想法已删除');
        }

        if (event.target.closest('[data-local-reader-context-note-edit]') && addButton) {
          if (dialogEditor) dialogEditor.value = text;
          addButton.dataset.localReaderContextEditing = 'true';
          addButton.click();
          delete addButton.dataset.localReaderContextEditing;
        }
      });

      closeButton?.addEventListener('click', () => close({ restoreFocus: true }));
      backdrop.addEventListener('click', () => close());
      readingContent?.addEventListener('click', (event) => {
        if (!event.target.closest('[data-local-reader-highlight]') && workspace.hasAttribute('data-local-reader-context-open')) close();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && workspace.hasAttribute('data-local-reader-context-open')) close({ restoreFocus: true });
      });
    });
  }

  function initLocalReadingProgress() {
    const root = $('[data-local-book-key]');
    if (!root) return;
    const readingPanel = $('[data-book-view-panel="reading"]', root);
    const progressNodes = $$('[data-local-reading-progress]', root);
    const statusNodes = $$('[data-local-reading-status]', root);
    const initialProgress = Number.parseInt(progressNodes[0]?.textContent || '0', 10) || 0;
    const start = Number.parseInt(root.dataset.localProgressStart || `${initialProgress}`, 10);
    const end = Number.parseInt(root.dataset.localProgressEnd || `${initialProgress}`, 10);
    const storageKey = `laoji-reading-progress:local-${root.dataset.localBookKey}`;
    const defaultState = { progress: initialProgress, scrollTop: 0 };
    let memoryState = defaultState;
    let frame = 0;

    function readState() {
      try {
        const stored = JSON.parse(safeStorage.getItem(storageKey) || 'null');
        if (stored && Number.isFinite(stored.progress) && Number.isFinite(stored.scrollTop)) return stored;
      } catch (_) { /* Restricted previews use the in-memory fallback. */ }
      return memoryState;
    }

    function writeState(state) {
      memoryState = state;
      safeStorage.setItem(storageKey, JSON.stringify(state));
    }

    function maxScroll() {
      return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    }

    function calculateProgress(scrollTop) {
      const ratio = Math.min(1, Math.max(0, scrollTop / maxScroll()));
      return Math.round(start + ratio * (end - start));
    }

    function render(progress, status = '阅读位置已保存') {
      progressNodes.forEach((node) => { node.textContent = `${progress}%`; });
      statusNodes.forEach((node) => { node.textContent = status; });
    }

    function save() {
      frame = 0;
      if (readingPanel?.hidden) return;
      const state = { progress: calculateProgress(window.scrollY), scrollTop: Math.round(window.scrollY) };
      writeState(state);
      render(state.progress, '刚刚已保存');
    }

    function scheduleSave() {
      if (frame || readingPanel?.hidden) return;
      frame = window.requestAnimationFrame(save);
    }

    window.addEventListener('load', () => {
      const state = readState();
      render(state.progress, state.scrollTop ? '已恢复上次进度' : '阅读位置已保存');
      if (!readingPanel?.hidden) window.requestAnimationFrame(() => window.scrollTo(0, Math.min(state.scrollTop, maxScroll())));
    });
    window.addEventListener('scroll', scheduleSave, { passive: true });
  }

  function initBookWorkspaceViews() {
    const panels = $$('[data-book-view-panel]');
    const controls = $$('[data-book-view]');
    if (!panels.length || !controls.length) return;
    const availableViews = panels.map((panel) => panel.dataset.bookViewPanel);
    const requestedView = new URLSearchParams(window.location.search).get('view');
    function show(view, updateUrl = false) {
      const nextView = availableViews.includes(view) ? view : availableViews[0];
      panels.forEach((panel) => { panel.hidden = panel.dataset.bookViewPanel !== nextView; });
      controls.forEach((control) => {
        if (control.closest('.book-mode-tabs')) {
          if (control.dataset.bookView === nextView) control.setAttribute('aria-current', 'page');
          else control.removeAttribute('aria-current');
        }
      });
      if (updateUrl && window.history?.replaceState) {
        try {
          const url = new URL(window.location.href);
          if (nextView === availableViews[0]) url.searchParams.delete('view');
          else url.searchParams.set('view', nextView);
          window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        } catch (_) { /* Some embedded previews restrict history updates; panel switching still works. */ }
      }
      window.scrollTo?.({ top: 0, behavior: 'auto' });
    }
    controls.forEach((control) => control.addEventListener('click', (event) => {
      event.preventDefault();
      show(control.dataset.bookView, true);
    }));
    show(requestedView || availableViews[0]);
  }

  function initSelectionToolbars() {
    $$('[data-selection-popover]').forEach((toolbar) => {
      const readingView = toolbar.closest('[data-book-view-panel="reading"]');
      if (!readingView) return;
      let frame = 0;

      function hide() {
        toolbar.hidden = true;
        toolbar.removeAttribute('data-open');
      }

      function update() {
        frame = 0;
        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          if (toolbar.contains(document.activeElement)) return;
          hide();
          return;
        }

        const range = selection.getRangeAt(0);
        const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement;
        const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
          ? range.endContainer
          : range.endContainer.parentElement;
        const surface = startElement?.closest('.reader-copy, .pdf-state[data-pdf-state="normal"]');
        if (!surface || !readingView.contains(surface) || !surface.contains(endElement)) {
          hide();
          return;
        }

        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) {
          hide();
          return;
        }

        toolbar.hidden = false;
        toolbar.setAttribute('data-open', 'true');
        const toolbarWidth = toolbar.getBoundingClientRect().width || 220;
        const halfWidth = toolbarWidth / 2;
        const x = Math.min(window.innerWidth - 16 - halfWidth, Math.max(16 + halfWidth, rect.left + rect.width / 2));
        const y = Math.max(64, rect.top);
        toolbar.style.left = `${x}px`;
        toolbar.style.top = `${y}px`;
      }

      function scheduleUpdate() {
        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(update);
      }

      document.addEventListener('selectionchange', scheduleUpdate);
      readingView.addEventListener('pointerup', scheduleUpdate);
      readingView.addEventListener('keyup', scheduleUpdate);
      toolbar.addEventListener('pointerdown', (event) => event.preventDefault());
      toolbar.addEventListener('click', () => {
        window.setTimeout(() => {
          window.getSelection?.()?.removeAllRanges();
          hide();
        }, 0);
      });
      toolbar.addEventListener('focusout', () => {
        window.setTimeout(() => {
          if (!toolbar.contains(document.activeElement) && window.getSelection?.()?.isCollapsed) hide();
        }, 0);
      });
      window.addEventListener('scroll', hide, { passive: true });
      window.addEventListener('resize', hide);
      hide();
    });
  }

  function initGlobalConfigurationState() {
    applyProfile();
    const state = window.LaojiState;
    state?.seed();
    const ai = state?.getConnection('ai') || 'unconfigured';
    const weread = state?.getConnection('weread') || 'disconnected';
    applyAiStatusLinks($$('a.ai-status'), ai);
    applyConnectionStatus($$('[data-ai-connection-state]'), ai);
    applyConnectionStatus($$('[data-weread-connection-state]'), weread);
    applyConnectionStatus($$('[data-connection-top-status="ai"]'), ai);
    applyConnectionStatus($$('[data-connection-top-status="weread"]'), weread);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initGlobalConfigurationState();
    initBookWorkspaceViews();
    initLocalBookNotes();
    initLocalReaderHighlightContext();
    initLocalReadingProgress();
    initSelectionToolbars();
    initLibrary();
    initLibraryImport();
    initDialogs();
    initTabs();
    initBookPptLists();
    initSegments();
    initNotes();
    initBookEmptyStates();
    initPanels();
    initPdfStates();
    initMaterials();
    initOutline();
    initPreview();
    initSettingsDetailPage();
    initSetupForms();
    initProfileSettings();
    initEmailChangeDialog();
    initAccountActions();
    initAuthForms();
    initPasswordRecovery();
    initConversationInputs();
    initChat();
    initBookPicker();
    initPptConversation();
    initUtilityActions();
  });
})();
