import re
with open('src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Import
content = content.replace("import { v4 as uuidv4 } from 'uuid';", "import { v4 as uuidv4 } from 'uuid';\nimport { font5x8 } from './lcdFont.js';")

# 2. Add state
content = content.replace("const [boardParts, setBoardParts] = useState([]);", "const [boardParts, setBoardParts] = useState([]);\n  const [lcdInput, setLcdInput] = useState(null);")

# 3. Add updateLcdDisplay function
update_fn = """
  const updateLcdDisplay = async (partId, text) => {
    setBoardParts(parts => {
      return parts.map(part => {
        if (part.instanceId === partId && part.svgString) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(part.svgString, 'image/svg+xml');
          const rects = Array.from(doc.querySelectorAll('rect'));
          const pixelRects = rects.filter(r => Math.abs(parseFloat(r.getAttribute('width') || '0')) - 0.54 < 0.1 || Math.abs(parseFloat(r.getAttribute('width') || '0')) - 0.533 < 0.1);
          
          if (pixelRects.length >= 1280) {
            const lines = text.split('|');
            for (let row = 0; row < 2; row++) {
              const lineText = lines[row] ? lines[row].padEnd(16, ' ') : '                ';
              for (let col = 0; col < 16; col++) {
                const charIndex = col;
                const char = lineText[charIndex];
                const charData = font5x8[char] || font5x8[' '];
                for (let pxRow = 0; pxRow < 8; pxRow++) {
                  for (let pxCol = 0; pxCol < 5; pxCol++) {
                    const rectIndex = (row * 16 * 40) + (pxRow * 16 * 5) + (col * 5) + pxCol;
                    if (rectIndex < pixelRects.length) {
                      const bit = (charData[pxCol] >> pxRow) & 1;
                      pixelRects[rectIndex].setAttribute('fill-opacity', bit ? '0.8' : '0.18');
                    }
                  }
                }
              }
            }
            const serializer = new XMLSerializer();
            part.svgString = serializer.serializeToString(doc);
            part.lcdText = text;
            try { 
              const b64 = btoa(unescape(encodeURIComponent(part.svgString)));
              part.image = new window.Image(); 
              part.image.src = 'data:image/svg+xml;base64,' + b64; 
            } catch(e){}
          }
        }
        return part;
      });
    });
  };
"""
content = content.replace("const handleSelect = (e, id) => {", update_fn + "\n  const handleSelect = (e, id) => {")

# 4. Modify onDblClick
content = re.sub(
    r"onDblClick=\{.*?\}",
    "onDblClick={(e) => { if (part.name.toLowerCase().includes('lcd')) { setLcdInput({ partId: part.instanceId, text: part.lcdText || '', x: e.evt.clientX, y: e.evt.clientY }); e.cancelBubble = true; } }}",
    content
)

# 5. Inject the Floating Input before Stage
inputHtml = """
            {lcdInput && (
              <div style={{ position: 'absolute', top: lcdInput.y, left: lcdInput.x, zIndex: 9999 }}>
                <input 
                  autoFocus
                  type="text" 
                  maxLength={32}
                  placeholder="輸入 LCD (用 | 隔開兩行)"
                  value={lcdInput.text}
                  onChange={(e) => setLcdInput({ ...lcdInput, text: e.target.value })}
                  onBlur={() => { updateLcdDisplay(lcdInput.partId, lcdInput.text); setLcdInput(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { updateLcdDisplay(lcdInput.partId, lcdInput.text); setLcdInput(null); } }}
                  style={{ padding: '4px', fontSize: '14px', width: '200px', boxShadow: '0px 0px 5px rgba(0,0,0,0.5)', border: '1px solid #333' }}
                />
              </div>
            )}
            <Stage """
# Revert spacing exactly with Regex to match "<Stage "
content = re.sub(r"\s*<Stage ", inputHtml, content)

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)