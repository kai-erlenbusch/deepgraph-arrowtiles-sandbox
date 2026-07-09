export function initUI() {
  const uiContainer = document.createElement('div');
  uiContainer.id = 'controls-ui';
  uiContainer.style.position = 'absolute';
  uiContainer.style.top = '20px';
  uiContainer.style.right = '20px';
  uiContainer.style.background = 'rgba(20, 20, 20, 0.9)';
  uiContainer.style.color = 'white';
  uiContainer.style.padding = '20px';
  uiContainer.style.borderRadius = '8px';
  uiContainer.style.fontFamily = 'sans-serif';
  uiContainer.style.zIndex = '1000';
  uiContainer.style.width = '300px';
  uiContainer.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
  uiContainer.style.border = '1px solid rgba(255,255,255,0.1)';

  uiContainer.innerHTML = `
    <h3 style="margin-top:0; border-bottom: 1px solid #444; padding-bottom: 10px;">Gaia Controls</h3>
    
    <div style="margin-bottom: 15px;">
      <label style="display:block; margin-bottom:5px; font-size: 14px;">Presets:</label>
      <div style="display: flex; gap: 10px;">
        <button id="preset-sky" style="flex:1; padding: 8px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">Night Sky</button>
        <button id="preset-hr" style="flex:1; padding: 8px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">HR Diagram</button>
      </div>
    </div>

    <div style="margin-bottom: 15px;">
      <label style="display:block; margin-bottom:5px; font-size: 14px;">X-Axis:</label>
      <select id="select-x" style="width:100%; padding: 8px; background: #222; color: white; border: 1px solid #444; border-radius: 4px;">
        <option value="x_u16">Right Ascension (RA)</option>
        <option value="bp_rp">Color (BP-RP)</option>
        <option value="parallax">Parallax</option>
      </select>
    </div>

    <div style="margin-bottom: 15px;">
      <label style="display:block; margin-bottom:5px; font-size: 14px;">Y-Axis:</label>
      <select id="select-y" style="width:100%; padding: 8px; background: #222; color: white; border: 1px solid #444; border-radius: 4px;">
        <option value="y_u16">Declination (Dec)</option>
        <option value="abs_m">Absolute Magnitude</option>
        <option value="parallax">Parallax</option>
      </select>
    </div>
  `;

  document.body.appendChild(uiContainer);

  const selectX = document.getElementById('select-x') as HTMLSelectElement;
  const selectY = document.getElementById('select-y') as HTMLSelectElement;
  
  const updateEncoding = () => {
    const xVal = selectX.value;
    const yVal = selectY.value;
    
    let config: any = {
      x: { field: xVal, transform: 'literal' },
      y: { field: yVal, transform: 'literal' }
    };
    
    if (xVal === 'x_u16') config.x = { field: 'x_u16', domain: [0, 1], range: [-2, 2], transform: 'linear' };
    if (yVal === 'y_u16') config.y = { field: 'y_u16', domain: [0, 1], range: [1, -1], transform: 'linear' };
    
    if (xVal === 'bp_rp') config.x = { field: 'bp_rp', domain: [-2, 4], range: [-2, 2], transform: 'linear' };
    if (yVal === 'abs_m') config.y = { field: 'abs_m', domain: [15, -5], range: [-2, 2], transform: 'linear' };

    const w = window as any;
    if (w.updateMap) w.updateMap(config);
  };

  selectX.addEventListener('change', updateEncoding);
  selectY.addEventListener('change', updateEncoding);

  document.getElementById('preset-sky')?.addEventListener('click', () => {
    selectX.value = 'x_u16';
    selectY.value = 'y_u16';
    updateEncoding();
  });

  document.getElementById('preset-hr')?.addEventListener('click', () => {
    selectX.value = 'bp_rp';
    selectY.value = 'abs_m';
    updateEncoding();
  });
}
