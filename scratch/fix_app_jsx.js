const fs = require('fs');
const path = 'frontend/src/App.jsx';
let content = fs.readFileSync(path, 'utf8');

// Fix creation form
content = content.replace(
  /id="new-keyword"\s+type="text"\s+list="window-titles-list"\s+placeholder="キーワード \(例: Google Calendar\)"\s+style={{ flex: 1,/,
  'id="new-keyword" type="text" list="window-titles-list" placeholder="キーワード (例: Google Calendar)" style={{ flex: "1 1 200px", minWidth: "150px",'
);
content = content.replace(
  /id="new-alias"\s+type="text"\s+placeholder="別名 \(例: 会議\)"\s+style={{ flex: 1,/,
  'id="new-alias" type="text" placeholder="別名 (例: 会議)" style={{ flex: "1 1 150px", minWidth: "100px",'
);

// Fix editing form
content = content.replace(
  /value={editKeyword}\s+onChange={\(e\) => setEditKeyword\(e.target.value\)}\s+style={{ flex: 1,/,
  'value={editKeyword} onChange={(e) => setEditKeyword(e.target.value)} style={{ flex: "1 1 150px", minWidth: "120px",'
);
content = content.replace(
  /value={editAlias}\s+onChange={\(e\) => setEditAlias\(e.target.value\)}\s+style={{ flex: 1,/,
  'value={editAlias} onChange={(e) => setEditAlias(e.target.value)} style={{ flex: "1 1 120px", minWidth: "100px",'
);

// Ensure flex-wrap is there for editing container too
content = content.replace(
  /{editingAliasId === item.id \?\s+\(\s+<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>\s+<div style={{ display: 'flex', gap: '0.5rem' }}>/,
  '{editingAliasId === item.id ? ( <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}> <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>'
);

fs.writeFileSync(path, content);
console.log('Fixed App.jsx');
