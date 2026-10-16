'use strict';
/* ============================================================
   main.js — 启动引导
   ============================================================ */

function boot() {
  App.state = defaultProject();
  initUI();

  const url = makeSampleBg('street');
  App._sampleKind = 'street';
  setBackground(url, () => {
    const st = App.state;
    const c = createChar(st.bgW * .30, st.bgH * .74, 1);
    c.name = '角色A';
    c.angle = -0.55;
    const k = createCam(st.bgW * .28, st.bgH * .93, 1);
    k.name = '机位1';
    st.objects.push(c, k);
    st.activeCam = k.id;
    App.lastCharId = c.id;
    App.sel = { kind: 'char', id: c.id };
    fitView();
    App.time = 0;
    refreshAll();
    toast('已就绪：试着选中角色 → 左侧点动作 / 画走位线');
  });

  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
