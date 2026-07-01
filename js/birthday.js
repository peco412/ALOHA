/**
 * birthday.js — Thông báo sinh nhật góc dưới phải màn hình
 * Kiểm tra khi đăng nhập: ai có sinh nhật hôm nay (dateOfBirth)
 * Hiện popup chúc mừng góc dưới phải, tự ẩn sau 10 giây
 */

const Birthday = (() => {
  async function checkAndShow() {
    const user = Auth.getCurrentUser();
    const allUsers = await DB.getTable('users:');
    const today = new Date();
    const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const bdays = allUsers.filter((u) => {
      if (!u.dateOfBirth) return false;
      const dob = new Date(u.dateOfBirth);
      const md = `${String(dob.getMonth()+1).padStart(2,'0')}-${String(dob.getDate()).padStart(2,'0')}`;
      return md === todayMD;
    });

    if (bdays.length === 0) return;

    // Kiểm tra hôm nay đã show chưa (tránh show lại khi reload)
    const shownKey = `aloha_bday_shown_${todayMD}`;
    if (sessionStorage.getItem(shownKey)) return;
    sessionStorage.setItem(shownKey, '1');

    bdays.forEach((u, idx) => {
      setTimeout(() => showCard(u, user.id === u.id), idx * 600);
    });
  }

  function showCard(u, isSelf) {
    const card = document.createElement('div');
    card.style.cssText = `
      position:fixed; bottom:${20 + document.querySelectorAll('.bday-card').length * 110}px;
      right:20px; z-index:9999; background:#fff; border:1px solid #fbbf24;
      border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.15);
      padding:14px 18px; max-width:300px; animation:slideInRight 0.4s ease;
    `;
    card.className = 'bday-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:28px;">🎂</span>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:14px;color:#92400e;">
            ${isSelf ? 'Chúc mừng sinh nhật bạn! 🎉' : `Sinh nhật hôm nay!`}
          </div>
          <div style="font-size:13px;margin-top:2px;">
            ${isSelf ? 'Chúc bạn một ngày sinh nhật thật vui vẻ và hạnh phúc!' : `Chúc mừng sinh nhật <strong>${UI.escapeHtml(u.name)}</strong>! 🎈`}
          </div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:#9ca3af;padding:0 0 0 4px;">✕</button>
      </div>
    `;
    document.body.appendChild(card);

    // Tự ẩn sau 10 giây
    setTimeout(() => {
      card.style.animation = 'fadeOut 0.4s ease forwards';
      setTimeout(() => card.remove(), 400);
    }, 10000);
  }

  return { checkAndShow };
})();
