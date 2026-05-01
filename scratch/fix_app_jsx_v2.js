const fs = require('fs');
const path = 'frontend/src/App.jsx';
let content = fs.readFileSync(path, 'utf8');

// Ensure flexShrink: 0 for edit color picker
content = content.replace(
  /type="color"\s+value={editColor}\s+onChange={\(e\) => setEditColor\(e.target.value\)}\s+style={{ width: '34px', height: '34px', padding: '0', border: 'none', background: 'transparent', cursor: 'pointer' }}/,
  'type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} style={{ width: "34px", height: "34px", padding: "0", border: "none", background: "transparent", cursor: "pointer", flexShrink: 0 }}'
);

fs.writeFileSync(path, content);
console.log('Final polish on App.jsx');
