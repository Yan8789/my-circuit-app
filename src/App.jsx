import { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Rect, Line, Text, Path } from 'react-konva';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { font5x8 } from './lcdFont.js';

const firebaseConfig = {
  apiKey: "AIzaSyBacXD5R0vmrBsXX0k9UGN1KLAZ42Vn7Bc",
  authDomain: "mycircuit-9919e.firebaseapp.com",
  projectId: "mycircuit-9919e",
  storageBucket: "mycircuit-9919e.firebasestorage.app",
  messagingSenderId: "173617783777",
  appId: "1:173617783777:web:c1d571949a1bc33369e8a0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "mycircuit"); 

const GRID_SIZE = 15;
const DPI_SCALE = GRID_SIZE / 9.6; 

const sqr = (x) => x * x;
const dist2 = (v, w) => sqr(v.x - w.x) + sqr(v.y - w.y);
const distToSegmentSquared = (p, v, w) => {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
};
const distToSegment = (p, v, w) => Math.sqrt(distToSegmentSquared(p, v, w));

const getRoundedPath = (points, radius = 8) => {
  if (points.length < 4) return `M ${points[0]} ${points[1]}`;
  if (points.length === 4) return `M ${points[0]} ${points[1]} L ${points[2]} ${points[3]}`;
  let path = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const p0 = { x: points[i - 2], y: points[i - 1] };
    const p1 = { x: points[i], y: points[i + 1] };
    const p2 = { x: points[i + 2], y: points[i + 3] };
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (d1 === 0 || d2 === 0) {
      path += ` L ${p1.x} ${p1.y}`;
      continue;
    }
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const p1xStart = p1.x - (p1.x - p0.x) * (r / d1);
    const p1yStart = p1.y - (p1.y - p0.y) * (r / d1);
    const p1xEnd = p1.x + (p2.x - p1.x) * (r / d2);
    const p1yEnd = p1.y + (p2.y - p1.y) * (r / d2);
    path += ` L ${p1xStart} ${p1yStart} Q ${p1.x} ${p1.y} ${p1xEnd} ${p1yEnd}`;
  }
  path += ` L ${points[points.length - 2]} ${points[points.length - 1]}`;
  return path;
};

const getPartGlobalPins = (part) => {
  const cx = part.width / 2; 
  const cy = part.height / 2; 
  const rad = part.rotation * Math.PI / 180;
  return part.pins.map(pin => {
    const px = pin.x - cx; 
    const py = pin.y - cy;
    const rx = px * Math.cos(rad) - py * Math.sin(rad); 
    const ry = px * Math.sin(rad) + py * Math.cos(rad);
    return { id: pin.id, gx: part.x + rx, gy: part.y + ry };
  });
};

const RESISTOR_COLORS = [
  { name: '黑 (0)', val: '#1a1a1a', mult: 1 },
  { name: '棕 (1)', val: '#8B4513', mult: 10, tol: '1%' },
  { name: '紅 (2)', val: '#FF0000', mult: 100, tol: '2%' },
  { name: '橙 (3)', val: '#FF8C00', mult: 1000 },
  { name: '黃 (4)', val: '#FFFF00', mult: 10000 },
  { name: '綠 (5)', val: '#008000', mult: 100000, tol: '0.5%' },
  { name: '藍 (6)', val: '#0000FF', mult: 1000000, tol: '0.25%' },
  { name: '紫 (7)', val: '#800080', mult: 10000000, tol: '0.1%' },
  { name: '灰 (8)', val: '#808080', mult: 100000000, tol: '0.05%' },
  { name: '白 (9)', val: '#FFFFFF', mult: 1000000000 },
  { name: '金 (x0.1)', val: '#FFD700', mult: 0.1, tol: '5%' },
  { name: '銀 (x0.01)', val: '#C0C0C0', mult: 0.01, tol: '10%' },
];

const getResistanceStr = (bands) => {
  const value = (bands[0] * 10 + bands[1]) * RESISTOR_COLORS[bands[2]].mult;
  const tol = RESISTOR_COLORS[bands[3]].tol || '';
  let formattedValue = value; let unit = 'Ω';
  if (value >= 1000000) { formattedValue = value / 1000000; unit = 'MΩ'; }
  else if (value >= 1000) { formattedValue = value / 1000; unit = 'kΩ'; }
  return `${Number.isInteger(formattedValue) ? formattedValue : formattedValue.toFixed(2)} ${unit} ±${tol}`;
};

function App() {
  const [library, setLibrary] = useState([]); 
  const [boardParts, setBoardParts] = useState([]); 
  const [wires, setWires] = useState([]); 
  const [texts, setTexts] = useState([]); 
  const [stageConfig, setStageConfig] = useState({ scale: 1, x: 0, y: 0 });
  const [bbRows, setBbRows] = useState(30); 
  const [bbStrips, setBbStrips] = useState(1);
  const [boardPos, setBoardPos] = useState({ x: GRID_SIZE * 4, y: GRID_SIZE * 4 });
  const [wireColor, setWireColor] = useState('#ff0000'); 
  const [drawingWire, setDrawingWire] = useState(null); 
  const [isUsbConnected, setIsUsbConnected] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTipsOpen, setIsTipsOpen] = useState(false);

  const [lcdInput, setLcdInput] = useState({ open: false, partInstanceId: null, value: '', x: 0, y: 0 });

  const [selectedItems, setSelectedItems] = useState([]); 
  const [selectionRect, setSelectionRect] = useState(null); 
  const [isPanning, setIsPanning] = useState(false); 
  const lastPanPos = useRef({ x: 0, y: 0 });
  const hasPanned = useRef(false);

  const draggingPartConnections = useRef([]);

  const hoveredPinRef = useRef(null);
  const stageRef = useRef(null);
  const lcdInputRef = useRef(null);

  const [editingTextColor, setEditingTextColor] = useState('#333333');
  const [editingTextSize, setEditingTextSize] = useState(24);
  const [savedProjects, setSavedProjects] = useState([]);
  const [selectedProjectName, setSelectedProjectName] = useState('');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);

  const singleSelectedItem = selectedItems.length === 1 ? selectedItems[0] : { id: null, type: null };

  // --- UNDO / REDO STATE ---
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const currentStateRef = useRef({ boardParts, wires, texts, bbRows, bbStrips, boardPos, isUsbConnected });
  useEffect(() => {
    currentStateRef.current = { boardParts, wires, texts, bbRows, bbStrips, boardPos, isUsbConnected };
  }, [boardParts, wires, texts, bbRows, bbStrips, boardPos, isUsbConnected]);

  const saveSnapshot = () => {
    const currentState = currentStateRef.current;
    setPast(prev => {
      if (prev.length > 0 && JSON.stringify(prev[prev.length - 1]) === JSON.stringify(currentState)) return prev;
      return [...prev, currentState];
    });
    setFuture([]);
  };

  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const previousState = past[past.length - 1];
    setPast(prev => prev.slice(0, prev.length - 1));
    setFuture(prev => [currentStateRef.current, ...prev]);
    
    setBoardParts(previousState.boardParts); setWires(previousState.wires); setTexts(previousState.texts);
    setBbRows(previousState.bbRows); setBbStrips(previousState.bbStrips); setBoardPos(previousState.boardPos); setIsUsbConnected(previousState.isUsbConnected);
  }, [past]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const nextState = future[0];
    setFuture(prev => prev.slice(1));
    setPast(prev => [...prev, currentStateRef.current]);
    
    setBoardParts(nextState.boardParts); setWires(nextState.wires); setTexts(nextState.texts);
    setBbRows(nextState.bbRows); setBbStrips(nextState.bbStrips); setBoardPos(nextState.boardPos); setIsUsbConnected(nextState.isUsbConnected);
  }, [future]);

  useEffect(() => {
    if (singleSelectedItem.type === 'text') {
      setTexts(prev => prev.map(t => t.id === singleSelectedItem.id ? { ...t, color: editingTextColor, fontSize: editingTextSize } : t));
    }
  }, [editingTextColor, editingTextSize]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Handle Undo/Redo Shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo(); else handleUndo();
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItems.length > 0) {
          saveSnapshot();
          setWires(prev => prev.filter(w => !selectedItems.some(s => s.id === w.id)));
          setBoardParts(prev => prev.filter(p => !selectedItems.some(s => s.id === p.instanceId)));
          setTexts(prev => prev.filter(t => !selectedItems.some(s => s.id === t.id)));
          setSelectedItems([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, handleUndo, handleRedo]);

  // 初始化时从Firebase加载库和项目列表
  useEffect(() => {
    const loadFromFirebase = async () => {
      try {
        // 加载保存的零件库
        const libSnapshot = await getDocs(collection(db, 'components'));
        if (libSnapshot.docs.length > 0) {
          const loadedLib = await Promise.all(libSnapshot.docs.map(async docSnap => {
            const item = docSnap.data();
            const img = new window.Image();
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(item.svgContent)));
            await new Promise(resolve => { img.onload = resolve; });
            return { ...item, img };
          }));
          setLibrary(loadedLib);
        }

        // 加载项目列表
        const projectSnapshot = await getDocs(collection(db, 'projects'));
        const projectNames = projectSnapshot.docs.map(doc => doc.id);
        setSavedProjects(projectNames);
      } catch (error) {
        console.error('初始化加载失败:', error);
      }
    };
    loadFromFirebase();
  }, []);

  const handleSaveToCloud = async () => {
    let projectName = prompt("☁️ 請為您的電路專案命名：", "Pico_Project_" + new Date().getTime().toString().slice(-6));
    if (!projectName) return;
    projectName = projectName.trim();
    
    const projectData = {
      library: library.map(({ img, ...rest }) => rest), 
      boardParts: boardParts.map(({ img, ...rest }) => rest),
      wires, texts, bbRows, bbStrips, boardPos, isUsbConnected,
      savedAt: new Date().toISOString()
    };
    try {
      await setDoc(doc(db, "projects", projectName), projectData);
      setSavedProjects(prev => prev.includes(projectName) ? prev : [...prev, projectName]);
      setSelectedProjectName(projectName);
      alert(`✅ 專案 [${projectName}] 已成功儲存！`);
    } catch (error) { alert("❌ 儲存失敗！" + error.message); }
  };

  const handleLoadFromCloud = async (projectName) => {
    if (!projectName) return;
    if (!window.confirm(`即將從雲端載入 [${projectName}]，這會覆蓋目前的畫布，確定嗎？`)) return;
    try {
      const docSnap = await getDoc(doc(db, "projects", projectName));
      if (docSnap.exists()) {
        saveSnapshot();
        const data = docSnap.data();
        // 將專案中不存在於目前零件庫的元件加入，但不覆蓋整個零件庫
        let updatedLibrary = [...library];
        const existingIds = new Set(updatedLibrary.map(l => l.id));
        
        const idMapping = {};
        const missingComponentsData = [];

        (data.library || []).forEach(item => {
          if (existingIds.has(item.id)) {
            idMapping[item.id] = item.id;
          } else {
            // 尋找是否已有相同名稱與內容的元件，避免重複疊加在零件庫
            const duplicateMatch = updatedLibrary.find(l => l.title === item.title && l.svgContent === item.svgContent);
            if (duplicateMatch) {
              idMapping[item.id] = duplicateMatch.id;
            } else {
              missingComponentsData.push(item);
              idMapping[item.id] = item.id;
            }
          }
        });

        if (missingComponentsData.length > 0) {
          const newComponents = await Promise.all(missingComponentsData.map(async item => {
            const img = new window.Image();
            img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(item.svgContent)));
            await new Promise(resolve => { img.onload = resolve; });
            return { ...item, img };
          }));
          updatedLibrary.push(...newComponents);
          setLibrary(updatedLibrary);
        }

        const rebuiltParts = await Promise.all((data.boardParts || []).map(async (part) => {
          if (['resistor', 'ceramic_cap', 'led'].includes(part.partType)) return part;
          if (typeof part.svgContent === 'string' && part.svgContent.length > 0) {
            const img = new window.Image();
            img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(part.svgContent)));
            await new Promise(resolve => { img.onload = resolve; });
            return { ...part, img };
          }
          const mappedId = idMapping[part.id] || part.id;
          const libItem = updatedLibrary.find(l => l.id === mappedId);
          return { ...part, id: mappedId, img: libItem ? libItem.img : null };
        }));
        setBoardParts(rebuiltParts); setWires(data.wires || []); setTexts(data.texts || []);
        setBbRows(data.bbRows || 30); setBbStrips(data.bbStrips || 1); setBoardPos(data.boardPos || { x: GRID_SIZE * 4, y: GRID_SIZE * 4 });
        setIsUsbConnected(data.isUsbConnected || false); setSelectedItems([]);
        setSelectedProjectName(projectName);
        alert(`✅ 成功載入！`);
      } else alert(`❌ 找不到專案！`);
    } catch (error) { console.error("讀取失敗：", error); alert("❌ 讀取失敗！"); }
  };

  const handleDeleteProject = async (projectName) => {
    if (!projectName) return;
    if (!window.confirm(`確定要永久刪除專案 [${projectName}] 嗎？此操作無法復原。`)) return;
    try {
      await deleteDoc(doc(db, "projects", projectName));
      setSavedProjects(prev => prev.filter(p => p !== projectName));
      if (selectedProjectName === projectName) {
        setSelectedProjectName('');
      }
      alert(`✅ 專案 [${projectName}] 已成功刪除！`);
    } catch (error) {
      console.error("刪除失敗：", error);
      alert("❌ 刪除失敗！" + error.message);
    }
  };

  const isLcdPart = (part) => {
    if (!part || typeof part.svgContent !== 'string') return false;
    return /lcd-pixel-\d+-\d+/.test(part.svgContent) || part.svgContent.includes('id="lcd-pixels"');
  };

  const updateLcdDisplay = async (partInstanceId, text) => {
    const targetPart = boardParts.find(p => p.instanceId === partInstanceId);
    if (!targetPart || typeof targetPart.svgContent !== 'string') return;
    if (!isLcdPart(targetPart)) return;

    const rawText = (text ?? '').toString();
    const processedText = rawText.replace(/Bell/gi, '\u0001');
    const normalizedText = processedText.padEnd(32, ' ').slice(0, 32);
    const onPixels = new Set();

    const customGlyphs = {
      '\u0001': [16, 30, 95, 30, 16] // Bell pattern
    };

    for (let row = 0; row < 2; row++) {
      const line = normalizedText.slice(row * 16, row * 16 + 16);
      for (let charIndex = 0; charIndex < 16; charIndex++) {
        const ch = line[charIndex] ?? ' ';
        const glyph = customGlyphs[ch] || font5x8[ch] || font5x8[' '];
        for (let gx = 0; gx < 5; gx++) {
          const colBits = glyph[gx] ?? 0;
          for (let gy = 0; gy < 8; gy++) {
            if ((colBits & (1 << gy)) === 0) continue;
            const r = row * 8 + gy;
            const c = charIndex * 6 + gx;
            onPixels.add(`${r}-${c}`);
          }
        }
      }
    }

    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(targetPart.svgContent, 'image/svg+xml');
    let pixelEls = Array.from(svgDoc.querySelectorAll('[id^="lcd-pixel-"]'));

    const lcdPixelsGroup = svgDoc.getElementById('lcd-pixels');
    if (lcdPixelsGroup && pixelEls.length === 0) {
      const X_POSITIONS = [27.79, 38.534, 49.278, 60.022, 70.768, 81.512, 92.256, 103.0, 113.744, 124.489, 135.233, 145.977, 156.721, 167.465, 178.209, 188.954];
      const ROW_Y = [34.154, 51.37];
      const CELL_W = 10.027; const CELL_H = 16.522;
      const COLS = 5; const ROWS = 8;
      const PAD_X = 0.8; const PAD_Y = 0.8; const GAP = 0.15;
      const PX_W = (CELL_W - 2 * PAD_X - GAP * (COLS - 1)) / COLS;
      const PX_H = (CELL_H - 2 * PAD_Y - GAP * (ROWS - 1)) / ROWS;
      const ns = 'http://www.w3.org/2000/svg';

      for (let rowIdx = 0; rowIdx < 2; rowIdx++) {
        const cy = ROW_Y[rowIdx];
        for (let colIdx = 0; colIdx < 16; colIdx++) {
          const cx = X_POSITIONS[colIdx];
          const bg = svgDoc.createElementNS(ns, 'rect');
          bg.setAttribute('x', cx); bg.setAttribute('y', cy);
          bg.setAttribute('width', CELL_W); bg.setAttribute('height', CELL_H);
          bg.setAttribute('fill', '#1A1A1A'); bg.setAttribute('fill-opacity', '0.08');
          lcdPixelsGroup.appendChild(bg);

          for (let py = 0; py < ROWS; py++) {
            for (let px = 0; px < COLS; px++) {
              const rect = svgDoc.createElementNS(ns, 'rect');
              const rx = cx + PAD_X + px * (PX_W + GAP);
              const ry = cy + PAD_Y + py * (PX_H + GAP);
              rect.setAttribute('x', rx.toFixed(3));
              rect.setAttribute('y', ry.toFixed(3));
              rect.setAttribute('width', PX_W.toFixed(3));
              rect.setAttribute('height', PX_H.toFixed(3));
              rect.setAttribute('rx', '0.1');
              rect.setAttribute('fill', '#1A1A1A');
              
              const r = rowIdx * 8 + py;
              const c = colIdx * 6 + px;
              rect.setAttribute('id', `lcd-pixel-${r}-${c}`);
              lcdPixelsGroup.appendChild(rect);
            }
          }
        }
      }
      pixelEls = Array.from(svgDoc.querySelectorAll('[id^="lcd-pixel-"]'));
    }

    if (pixelEls.length === 0) return;

    pixelEls.forEach((el) => {
      const id = el.getAttribute('id') || '';
      const m = id.match(/^lcd-pixel-(\d+)-(\d+)$/);
      if (!m) return;
      const key = `${Number(m[1])}-${Number(m[2])}`;
      el.setAttribute('opacity', onPixels.has(key) ? '1' : '0');
    });

    const updatedSvgContent = new XMLSerializer().serializeToString(svgDoc);
    const img = new window.Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(updatedSvgContent)));
    await new Promise(resolve => { img.onload = resolve; });

    saveSnapshot();
    setBoardParts(prev => prev.map(p => (
      p.instanceId === partInstanceId
        ? { ...p, svgContent: updatedSvgContent, img, lcdText: rawText }
        : p
    )));
  };

  const openLcdEditor = (part, e) => {
    if (!isLcdPart(part)) return;
    e.cancelBubble = true;
    e.evt?.preventDefault?.();

    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.container().getBoundingClientRect();

    const x = (e.evt?.clientX ?? rect.left) - rect.left;
    const y = (e.evt?.clientY ?? rect.top) - rect.top;

    setLcdInput({
      open: true,
      partInstanceId: part.instanceId,
      value: (part.lcdText ?? '').toString(),
      x: Math.max(0, Math.min(rect.width - 10, x)),
      y: Math.max(0, Math.min(rect.height - 10, y))
    });
    setTimeout(() => lcdInputRef.current?.focus(), 0);
  };

  const handleExportImage = () => {
    setSelectedItems([]);
    setTimeout(() => {
      if (stageRef.current) {
        const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `Circuit_${Date.now()}.png`;
        link.click();
      }
    }, 150);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const zip = new JSZip(); const contents = await zip.loadAsync(file);
      let fzpXmlString = "", svgContent = "";
      for (const filename of Object.keys(contents.files)) {
        if (filename.endsWith('.fzp')) fzpXmlString = await contents.files[filename].async('text');
        else if (filename.includes('breadboard') && filename.endsWith('.svg')) svgContent = await contents.files[filename].async('text');
      }
      if (!fzpXmlString || !svgContent) return alert("找不到 XML 或 SVG 檔！");

      const parser = new DOMParser(); const xmlDoc = parser.parseFromString(fzpXmlString, "text/xml");
      const title = xmlDoc.querySelector('title')?.textContent || "未知元件";
      const connectors = Array.from(xmlDoc.querySelectorAll('connector')).map(n => ({
        id: n.getAttribute('id'), name: n.getAttribute('name'), svgId: n.querySelector('breadboardView p')?.getAttribute('svgId') || null
      }));

      const svgDoc = parser.parseFromString(svgContent, "image/svg+xml"); const svgRoot = svgDoc.querySelector('svg');
      let vbWidth = parseFloat(svgRoot.getAttribute('viewBox')?.split(/[ ,]+/)[2]) || parseFloat(svgRoot.getAttribute('width')) || 1;
      let vbHeight = parseFloat(svgRoot.getAttribute('viewBox')?.split(/[ ,]+/)[3]) || parseFloat(svgRoot.getAttribute('height')) || 1;

      const img = new window.Image(); img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgContent)));
      img.onload = async () => {
        const extractedPins = [];
        connectors.forEach(conn => {
          if (!conn.svgId) return; const el = svgDoc.getElementById(conn.svgId);
          if (el) {
            let x = parseFloat(el.getAttribute('cx') || el.getAttribute('x') || 0); let y = parseFloat(el.getAttribute('cy') || el.getAttribute('y') || 0);
            if (el.tagName.toLowerCase() === 'rect') { x += parseFloat(el.getAttribute('width') || 0) / 2; y += parseFloat(el.getAttribute('height') || 0) / 2; }
            extractedPins.push({ id: conn.id, name: conn.name, x: x * (img.width / vbWidth) * DPI_SCALE, y: y * (img.height / vbHeight) * DPI_SCALE });
          }
        });
        
        const componentId = Date.now().toString();
        const newComponent = { id: componentId, title, svgContent, pins: extractedPins, width: img.width * DPI_SCALE, height: img.height * DPI_SCALE };
        
        // 保存到Firebase
        try {
          await setDoc(doc(db, 'components', componentId), newComponent);
          setLibrary(prev => [...prev, { ...newComponent, img }]);
          alert(`✅ 零件 [${title}] 已上传并保存！`);
        } catch (error) {
          console.error('保存失败:', error);
          alert('❌ 保存到云端失败，但零件已在本地加载');
          setLibrary(prev => [...prev, { ...newComponent, img }]);
        }
      };
    } catch (error) { console.error("解析失敗:", error); }
    event.target.value = null; 
  };

  const alignPartPinsToBreadboard = (part, maxSnapDistance = GRID_SIZE * 2) => {
    if (!part || !part.pins || part.pins.length === 0) return { x: part.x, y: part.y, snapped: false };

    const globalPins = getPartGlobalPins(part);
    let best = null;

    for (const gPin of globalPins) {
      for (const hole of bbLayout.holes) {
        const holeX = boardPos.x + hole.x;
        const holeY = boardPos.y + hole.y;
        const dx = holeX - gPin.gx;
        const dy = holeY - gPin.gy;
        const d2 = dx * dx + dy * dy;
        if (!best || d2 < best.d2) best = { d2, dx, dy };
      }
    }

    if (!best) return { x: part.x, y: part.y, snapped: false };
    const dist = Math.sqrt(best.d2);
    if (dist > maxSnapDistance) return { x: part.x, y: part.y, snapped: false };
    return { x: part.x + best.dx, y: part.y + best.dy, snapped: true };
  };

  const addPartToBoard = (template) => {
    const centerX = (-stageConfig.x + window.innerWidth / 2) / stageConfig.scale;
    const centerY = (-stageConfig.y + window.innerHeight / 2) / stageConfig.scale;
    const snapX = Math.round(centerX / GRID_SIZE) * GRID_SIZE;
    const snapY = Math.round(centerY / GRID_SIZE) * GRID_SIZE;
    const basePart = { ...template, instanceId: Date.now().toString(), x: snapX, y: snapY, rotation: 0 };
    const aligned = alignPartPinsToBreadboard(basePart);
    const newPart = aligned.snapped ? { ...basePart, x: aligned.x, y: aligned.y } : basePart;
    saveSnapshot();
    setBoardParts(prev => [...prev, newPart]);
  };

  const addDynamicPart = (type) => {
    const centerX = (-stageConfig.x + window.innerWidth / 2) / stageConfig.scale;
    const centerY = (-stageConfig.y + window.innerHeight / 2) / stageConfig.scale;
    const snapX = Math.round(centerX / GRID_SIZE) * GRID_SIZE;
    const snapY = Math.round(centerY / GRID_SIZE) * GRID_SIZE;
    
    let newPart = { instanceId: Date.now().toString(), partType: type, x: snapX, y: snapY, rotation: 0 };

    switch(type) {
      case 'resistor':
        newPart = { ...newPart, title: '電阻', width: 60, height: 15, bands: [1, 0, 2, 10], pins: [{ id: 'p1', x: 7.5, y: 7.5 }, { id: 'p2', x: 52.5, y: 7.5 }] }; break;
      case 'ceramic_cap':
        newPart = { ...newPart, title: '陶瓷電容', width: 30, height: 15, pins: [{ id: 'p1', x: 7.5, y: 7.5 }, { id: 'p2', x: 22.5, y: 7.5 }] }; break;
      case 'led':
        newPart = { ...newPart, title: 'LED', width: 30, height: 15, color: '#e74c3c', pins: [{ id: 'p1', x: 7.5, y: 7.5 }, { id: 'p2', x: 22.5, y: 7.5 }] }; break;
      default: return;
    }
    saveSnapshot();
    setBoardParts(prev => [...prev, newPart]);
  };

  const handleDynamicPropChange = (id, propName, value) => {
    saveSnapshot();
    setBoardParts(prev => prev.map(p => (p.instanceId === id ? { ...p, [propName]: value } : p)));
  };

  const handleResistorBandChange = (id, bandIdx, colorIdx) => {
    saveSnapshot();
    setBoardParts(prev => prev.map(p => {
      if (p.instanceId === id && p.partType === 'resistor') {
        const newBands = [...p.bands]; newBands[bandIdx] = colorIdx; return { ...p, bands: newBands };
      }
      return p;
    }));
  };

  const renderPartGraphics = (part, isSelected) => {
    const shadow = { shadowBlur: isSelected ? 12 : 2, shadowColor: isSelected ? "#00e5ff" : "black" };
    const legColor = "#8C929A";
    
    switch (part.partType) {
      case 'resistor':
        return (
          <Group>
            <Line points={[7.5, 7.5, 20, 7.5]} stroke={legColor} strokeWidth={2.5} lineCap="round" />
            <Line points={[40, 7.5, 52.5, 7.5]} stroke={legColor} strokeWidth={2.5} lineCap="round" />
            <Rect x={20} y={2.5} width={20} height={10} fill="#e3c39a" cornerRadius={3} {...shadow} />
            <Rect x={22} y={2.5} width={2} height={10} fill={RESISTOR_COLORS[part.bands[0]].val} />
            <Rect x={26} y={2.5} width={2} height={10} fill={RESISTOR_COLORS[part.bands[1]].val} />
            <Rect x={30} y={2.5} width={2} height={10} fill={RESISTOR_COLORS[part.bands[2]].val} />
            <Rect x={36} y={2.5} width={2} height={10} fill={RESISTOR_COLORS[part.bands[3]].val} />
          </Group>
        );
      case 'ceramic_cap':
        return (
          <Group>
            <Line points={[7.5, 7.5, 7.5, -1, 12, -4]} stroke={legColor} strokeWidth={2.5} />
            <Line points={[22.5, 7.5, 22.5, -1, 18, -4]} stroke={legColor} strokeWidth={2.5} />
            <Circle x={15} y={-6} radius={9} fill="#E67E22" {...shadow} />
            <Text x={9} y={-10} text="104" fontSize={8} fill="#fff" fontStyle="bold" />
          </Group>
        );
      case 'led':
        return (
          <Group>
            <Line points={[7.5, 7.5, 7.5, 0, 10.5, -4, 10.5, -12]} stroke={legColor} strokeWidth={2.5} lineCap="round" lineJoin="round" />
            <Line points={[22.5, 7.5, 22.5, -12]} stroke={legColor} strokeWidth={2.5} lineCap="round" />
            <Line points={[10.5, -12, 10.5, -18]} stroke="#000" strokeWidth={2.5} opacity={0.25} />
            <Rect x={10.5} y={-24} width={14} height={10} fill="#000" cornerRadius={1} opacity={0.25} />
            <Line points={[22.5, -12, 22.5, -16]} stroke="#000" strokeWidth={2.5} opacity={0.25} />
            <Rect x={4.5} y={-14} width={26} height={5} fill={part.color} cornerRadius={1.5} opacity={0.95} {...shadow} />
            <Rect x={6.5} y={-32} width={22} height={19} fill={part.color} cornerRadius={[11, 11, 0, 0]} opacity={0.85} />
            <Rect x={8.5} y={-29} width={5} height={8} fill="#ffffff" opacity={0.4} cornerRadius={2} />
          </Group>
        );
      default:
        return part.img ? <KonvaImage image={part.img} width={part.width} height={part.height} shadowBlur={isSelected ? 20 : 0} shadowColor="blue" /> : null;
    }
  };

  const getLocalPos = (node) => {
    const stage = node.getStage();
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
    return transform.point(node.getAbsolutePosition());
  };

  const handleWireDblClick = (e, wireId) => { 
    e.cancelBubble = true; const stage = e.target.getStage(); const pointer = stage.getPointerPosition();
    if (!pointer) return; 
    const clickPos = { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() };
    saveSnapshot();
    setWires(prev => prev.map(w => {
      if (w.id !== wireId) return w;
      const pts = w.points; let minD = Infinity; let insertIdx = 2; 
      for (let i = 0; i < pts.length - 2; i += 2) {
        const v = { x: pts[i], y: pts[i+1] }; const wPt = { x: pts[i+2], y: pts[i+3] };
        const d = distToSegment(clickPos, v, wPt);
        if (d < minD) { minD = d; insertIdx = i + 2; }
      }
      const newPts = [...pts]; newPts.splice(insertIdx, 0, clickPos.x, clickPos.y);
      return { ...w, points: newPts };
    }));
  };

  const handleJointDragMove = (e, wireId, index) => {
    const newX = e.target.x(); const newY = e.target.y();
    setWires(prev => prev.map(w => {
      if (w.id !== wireId) return w;
      const newPts = [...w.points]; newPts[index] = newX; newPts[index + 1] = newY;
      return { ...w, points: newPts };
    }));
  };

  const handleJointDragEnd = (e, wireId, index) => {
    const snappedX = Math.round(e.target.x() / GRID_SIZE) * GRID_SIZE; const snappedY = Math.round(e.target.y() / GRID_SIZE) * GRID_SIZE;
    setWires(prev => prev.map(w => {
      if (w.id !== wireId) return w;
      const newPts = [...w.points]; newPts[index] = snappedX; newPts[index + 1] = snappedY;
      return { ...w, points: newPts };
    }));
  };

  const handleJointDblClick = (e, wireId, index) => {
    e.cancelBubble = true;
    saveSnapshot();
    setWires(prev => prev.map(w => {
      if (w.id !== wireId) return w;
      const newPts = [...w.points]; newPts.splice(index, 2); return { ...w, points: newPts };
    }));
  };

  const handlePinMouseEnter = (e) => { e.target.getStage().container().style.cursor = 'crosshair'; e.target.setAttr('originalFill', e.target.fill()); e.target.fill("#00ff00"); e.target.radius(5); };
  const handlePinMouseLeave = (e) => { e.target.getStage().container().style.cursor = 'default'; e.target.fill(e.target.getAttr('originalFill')); e.target.radius(2.5); };

  const handleStartWire = (e) => {
    e.cancelBubble = true; const pos = getLocalPos(e.target);
    setDrawingWire({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y, color: wireColor });
  };

  const handleStageMouseDown = (e) => {
    if (e.evt.button === 2) {
      e.evt.preventDefault();
      setIsPanning(true);
      hasPanned.current = false;
      lastPanPos.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    if (e.target !== e.target.getStage()) return;

    if (e.evt.button === 0) {
      setSelectedItems([]);
      const stage = e.target.getStage();
      const pointerPos = stage.getPointerPosition();
      const scale = stage.scaleX();
      const localX = (pointerPos.x - stage.x()) / scale;
      const localY = (pointerPos.y - stage.y()) / scale;
      setSelectionRect({ startX: localX, startY: localY, width: 0, height: 0 });
    }
  };

  const handleStageMouseMove = (e) => {
    if (isPanning) {
      const dx = e.evt.clientX - lastPanPos.current.x;
      const dy = e.evt.clientY - lastPanPos.current.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) hasPanned.current = true;
      setStageConfig(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastPanPos.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    if (selectionRect) {
      const stage = e.target.getStage();
      const pointerPos = stage.getPointerPosition();
      const scale = stage.scaleX();
      const localX = (pointerPos.x - stage.x()) / scale;
      const localY = (pointerPos.y - stage.y()) / scale;
      setSelectionRect(prev => ({ ...prev, width: localX - prev.startX, height: localY - prev.startY }));
      return;
    }

    if (!drawingWire) return;
    const stage = e.target.getStage(); const pointer = stage.getPointerPosition(); if (!pointer) return; 
    const localPos = { x: (pointer.x - stage.x()) / stageConfig.scale, y: (pointer.y - stage.y()) / stageConfig.scale };
    
    let closest = null, minDist = 15;
    for (let hole of bbLayout.holes) {
        const gx = boardPos.x + hole.x; const gy = boardPos.y + hole.y;
        if (Math.hypot(gx - localPos.x, gy - localPos.y) < minDist) { minDist = Math.hypot(gx - localPos.x, gy - localPos.y); closest = { x: gx, y: gy }; }
    }
    
    for (let part of boardParts) {
        const globalPins = getPartGlobalPins(part);
        for (let gPin of globalPins) {
            if (Math.hypot(gPin.gx - localPos.x, gPin.gy - localPos.y) < minDist) { 
                minDist = Math.hypot(gPin.gx - localPos.x, gPin.gy - localPos.y); 
                closest = { x: gPin.gx, y: gPin.gy }; 
            }
        }
    }
    hoveredPinRef.current = closest; 
    setDrawingWire({ ...drawingWire, endX: closest ? closest.x : localPos.x, endY: closest ? closest.y : localPos.y });
  };

  const handleStageMouseUp = (e) => {
    if (e && e.evt && e.evt.button === 2) {
      setIsPanning(false);
      return;
    }

    if (selectionRect) {
      const minX = Math.min(selectionRect.startX, selectionRect.startX + selectionRect.width);
      const maxX = Math.max(selectionRect.startX, selectionRect.startX + selectionRect.width);
      const minY = Math.min(selectionRect.startY, selectionRect.startY + selectionRect.height);
      const maxY = Math.max(selectionRect.startY, selectionRect.startY + selectionRect.height);

      const newSelected = [];
      boardParts.forEach(p => { if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) newSelected.push({ id: p.instanceId, type: 'part' }); });
      texts.forEach(t => { if (t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY) newSelected.push({ id: t.id, type: 'text' }); });
      wires.forEach(w => {
        let isInside = false;
        for (let i = 0; i < w.points.length; i += 2) {
          if (w.points[i] >= minX && w.points[i] <= maxX && w.points[i+1] >= minY && w.points[i+1] <= maxY) { isInside = true; break; }
        }
        if (isInside) newSelected.push({ id: w.id, type: 'wire' });
      });

      setSelectedItems(newSelected);
      setSelectionRect(null);
      return;
    }

    if (drawingWire && hoveredPinRef.current) {
      saveSnapshot();
      const endPoint = hoveredPinRef.current;
      setWires(prev => [...prev, { id: Date.now().toString(), points: [drawingWire.startX, drawingWire.startY, endPoint.x, endPoint.y], color: drawingWire.color }]);
    }
    setDrawingWire(null); hoveredPinRef.current = null;
  };

  const boardDragStartPos = useRef({ x: 0, y: 0 }); const initialPartsPos = useRef([]); const initialWiresPos = useRef([]);

  const handleBoardDragStart = (e) => {
    if (e.evt.button === 2) { e.target.stopDrag(); return; }
    if (e.target.id() !== 'breadboard-group' && e.target.nodeType !== 'Rect' && e.target.nodeType !== 'Text') return;
    saveSnapshot();
    boardDragStartPos.current = { x: boardPos.x, y: boardPos.y };
    initialPartsPos.current = boardParts.map(p => ({ ...p })); initialWiresPos.current = wires.map(w => ({ ...w, points: [...w.points] }));
  };

  const handleBoardDragMove = (e) => {
    if (e.target.id() !== 'breadboard-group' && e.target.nodeType !== 'Rect' && e.target.nodeType !== 'Text') return;
    const dx = e.target.x() - boardDragStartPos.current.x; const dy = e.target.y() - boardDragStartPos.current.y;
    setBoardPos({ x: e.target.x(), y: e.target.y() });
    const startX = boardDragStartPos.current.x; const startY = boardDragStartPos.current.y;
    const isPointOnBoard = (x, y) => x >= startX && x <= startX + bbLayout.width && y >= startY && y <= startY + bbLayout.height;

    setBoardParts(initialPartsPos.current.map(p => (isPointOnBoard(p.x, p.y) ? { ...p, x: p.x + dx, y: p.y + dy } : p)));
    setWires(initialWiresPos.current.map(w => {
        let newPoints = [...w.points];
        for (let i = 0; i < newPoints.length; i += 2) { if (isPointOnBoard(newPoints[i], newPoints[i+1])) { newPoints[i] += dx; newPoints[i+1] += dy; } }
        return { ...w, points: newPoints };
    }));
  };

  const handleBoardDragEnd = (e) => {
    if (e.target.id() !== 'breadboard-group' && e.target.nodeType !== 'Rect' && e.target.nodeType !== 'Text') return;
    const snappedX = Math.round(e.target.x() / GRID_SIZE) * GRID_SIZE; const snappedY = Math.round(e.target.y() / GRID_SIZE) * GRID_SIZE;
    const dx = snappedX - boardDragStartPos.current.x; const dy = snappedY - boardDragStartPos.current.y;
    setBoardPos({ x: snappedX, y: snappedY }); 
    const startX = boardDragStartPos.current.x; const startY = boardDragStartPos.current.y;
    const isPointOnBoard = (x, y) => x >= startX && x <= startX + bbLayout.width && y >= startY && y <= startY + bbLayout.height;

    setBoardParts(initialPartsPos.current.map(p => (isPointOnBoard(p.x, p.y) ? { ...p, x: p.x + dx, y: p.y + dy } : p)));
    setWires(initialWiresPos.current.map(w => {
        let newPoints = [...w.points];
        for (let i = 0; i < newPoints.length; i += 2) { if (isPointOnBoard(newPoints[i], newPoints[i+1])) { newPoints[i] += dx; newPoints[i+1] += dy; } }
        return { ...w, points: newPoints };
    }));
  };

  const handlePartDragStart = (e, partId) => {
    if (e.evt.button === 2) { e.target.stopDrag(); return; }
    
    const part = boardParts.find(p => p.instanceId === partId);
    if (!part) return;

    saveSnapshot();
    const globalPins = getPartGlobalPins(part);
    const connections = [];

    wires.forEach(w => {
      globalPins.forEach(gPin => {
        if (Math.hypot(w.points[0] - gPin.gx, w.points[1] - gPin.gy) < 5) {
          connections.push({ wireId: w.id, pointIndex: 0, pinId: gPin.id });
        }
        const lastIdx = w.points.length - 2;
        if (Math.hypot(w.points[lastIdx] - gPin.gx, w.points[lastIdx+1] - gPin.gy) < 5) {
          connections.push({ wireId: w.id, pointIndex: lastIdx, pinId: gPin.id });
        }
      });
    });

    draggingPartConnections.current = connections;
  };

  const handlePartDragMove = (e, partId) => {
    const newX = e.target.x();
    const newY = e.target.y();
    
    setBoardParts(prev => prev.map(p => p.instanceId === partId ? { ...p, x: newX, y: newY } : p));
    
    if (draggingPartConnections.current.length > 0) {
      const activeBindings = [...draggingPartConnections.current];
      const part = boardParts.find(p => p.instanceId === partId);
      if (part) {
        const newGlobalPins = getPartGlobalPins({ ...part, x: newX, y: newY });
        setWires(prevWires => prevWires.map(w => {
          const bindings = activeBindings.filter(b => b.wireId === w.id);
          if (bindings.length === 0) return w;
          
          const newPoints = [...w.points];
          bindings.forEach(b => {
            const gPin = newGlobalPins.find(p => p.id === b.pinId);
            if (gPin) { newPoints[b.pointIndex] = gPin.gx; newPoints[b.pointIndex + 1] = gPin.gy; }
          });
          return { ...w, points: newPoints };
        }));
      }
    }
  };

  // 依照引腳位置優先吸附到麵包板洞位，若不在附近則回退到網格吸附
  const handleItemDragEnd = (e, id, type) => {
    if (type === 'text') { setTexts(prev => prev.map(t => t.id === id ? { ...t, x: Math.round(e.target.x()/GRID_SIZE)*GRID_SIZE, y: Math.round(e.target.y()/GRID_SIZE)*GRID_SIZE } : t)); return; }
    
    if (type === 'part') {
      const part = boardParts.find(p => p.instanceId === id);
      if (!part) return;

      const draggedPart = { ...part, x: e.target.x(), y: e.target.y() };
      const aligned = alignPartPinsToBreadboard(draggedPart);

      let snappedX;
      let snappedY;
      if (aligned.snapped) {
        snappedX = aligned.x;
        snappedY = aligned.y;
      } else if (part.rotation % 180 !== 0) {
        snappedX = Math.round((e.target.x() - GRID_SIZE/2) / GRID_SIZE) * GRID_SIZE + GRID_SIZE/2;
        snappedY = Math.round((e.target.y() - GRID_SIZE/2) / GRID_SIZE) * GRID_SIZE + GRID_SIZE/2;
      } else {
        snappedX = Math.round(e.target.x() / GRID_SIZE) * GRID_SIZE;
        snappedY = Math.round(e.target.y() / GRID_SIZE) * GRID_SIZE;
      }
      
      setBoardParts(prev => prev.map(p => p.instanceId === id ? { ...p, x: snappedX, y: snappedY } : p));

      if (draggingPartConnections.current.length > 0) {
        const activeBindings = [...draggingPartConnections.current];
        const newGlobalPins = getPartGlobalPins({ ...part, x: snappedX, y: snappedY });
        
        setWires(prevWires => prevWires.map(w => {
          const bindings = activeBindings.filter(b => b.wireId === w.id);
          if (bindings.length === 0) return w;
          
          const newPoints = [...w.points];
          bindings.forEach(b => {
            const gPin = newGlobalPins.find(p => p.id === b.pinId);
            if (gPin) { newPoints[b.pointIndex] = gPin.gx; newPoints[b.pointIndex + 1] = gPin.gy; }
          });
          return { ...w, points: newPoints };
        }));
      }
      
      draggingPartConnections.current = [];
    }
  };

  const handleTextDragMove = (e, id) => { setTexts(prev => prev.map(t => t.id === id ? { ...t, x: e.target.x(), y: e.target.y() } : t)); };

  const handleWheel = (e) => {
    e.evt.preventDefault(); const stage = e.target.getStage(); const pointer = stage.getPointerPosition(); if (!pointer) return; 
    const scaleBy = 1.1; const oldScale = stage.scaleX();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    setStageConfig({ scale: newScale, x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  };

  const handleItemClick = (e, id, type) => {
    e.cancelBubble = true; 
    if (e.evt.button === 2) return; 
    setSelectedItems([{ id, type }]); 
    if (type === 'text') { const text = texts.find(t => t.id === id); if (text) { setEditingTextColor(text.color); setEditingTextSize(text.fontSize); } }
    if (type === 'wire') { const wire = wires.find(w => w.id === id); if (wire) setWireColor(wire.color); }
  };

  const addTextNode = () => {
    const centerX = (-stageConfig.x + window.innerWidth / 2) / stageConfig.scale; const centerY = (-stageConfig.y + window.innerHeight / 2) / stageConfig.scale;
    saveSnapshot();
    setTexts(prev => [...prev, { id: Date.now().toString(), x: centerX, y: centerY - 100, text: '雙擊以編輯文字', fontSize: 24, color: '#333333' }]);
  };

  const generateBreadboard = () => {
    const holes = [];
    const segmentWidth = 24 * GRID_SIZE;
    const segmentHeight = (bbRows + 2) * GRID_SIZE;
    const segmentGap = 2 * GRID_SIZE;
    const segmentLefts = [];

    for (let s = 0; s < bbStrips; s++) {
      const xOffset = s * (segmentWidth + segmentGap);
      segmentLefts.push(xOffset);
      for (let row = 0; row < bbRows; row++) {
        const y = (row + 1) * GRID_SIZE;
        holes.push({ x: xOffset + 1.5 * GRID_SIZE, y, type: 'power', color: '#ff4444' });
        holes.push({ x: xOffset + 2.5 * GRID_SIZE, y, type: 'power', color: '#4444ff' });
        for (let c = 4.5; c <= 8.5; c++) holes.push({ x: xOffset + c * GRID_SIZE, y, type: 'terminal', color: '#555' });
        for (let c = 15.5; c <= 19.5; c++) holes.push({ x: xOffset + c * GRID_SIZE, y, type: 'terminal', color: '#555' });
        holes.push({ x: xOffset + 21.5 * GRID_SIZE, y, type: 'power', color: '#4444ff' });
        holes.push({ x: xOffset + 22.5 * GRID_SIZE, y, type: 'power', color: '#ff4444' });
      }
    }

    const width = bbStrips * segmentWidth + (bbStrips - 1) * segmentGap;
    const height = segmentHeight;
    return { width, height, holes, segmentLefts, segmentHeight, segmentWidth };
  };
  const bbLayout = generateBreadboard();

  const selectedDynamicPart = (singleSelectedItem.type === 'part') ? boardParts.find(p => p.instanceId === singleSelectedItem.id) : null;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }} onContextMenu={(e) => e.preventDefault()}>
      
      {/* ================= 上方工具列 ================= */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', padding: '10px 20px', background: '#f5f5f5', borderRadius: '8px', flexWrap: 'wrap' }}>
        
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{ padding: '6px 12px', background: '#e0e0e0', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            {isSidebarOpen ? '◀ 收合' : '▶ 展開'}
          </button>
          
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', borderLeft: '2px solid #ccc', paddingLeft: '15px' }}>
            <b>排數:</b><input type="number" value={bbRows} onChange={e => { saveSnapshot(); setBbRows(Number(e.target.value)); }} style={{width: '60px'}} />
          </div>

          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', borderLeft: '2px solid #ccc', paddingLeft: '15px' }}>
            <b>條數:</b>
            <select value={bbStrips} onChange={e => { saveSnapshot(); setBbStrips(Number(e.target.value)); }}>
              <option value={1}>單條</option>
              <option value={2}>雙條</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', borderLeft: '2px solid #ccc', paddingLeft: '15px' }}>
            <b>導線:</b>
            {['#ff0000', '#000000', '#0000ff', '#00ff00', '#ffff00'].map(c => (
              <div key={c} onClick={() => { if (selectedItems.some(s => s.type === 'wire')) saveSnapshot(); setWireColor(c); if (selectedItems.some(s => s.type === 'wire')) setWires(prev => prev.map(w => selectedItems.some(s => s.id === w.id) ? { ...w, color: c } : w)); }} style={{ width: '20px', height: '20px', backgroundColor: c, border: wireColor === c ? '3px solid #333' : '1px solid #ccc', cursor: 'pointer', borderRadius: '50%' }} />
            ))}
            <input type="color" value={wireColor} onChange={e => { if (selectedItems.some(s => s.type === 'wire')) saveSnapshot(); setWireColor(e.target.value); if (selectedItems.some(s => s.type === 'wire')) setWires(prev => prev.map(w => selectedItems.some(s => s.id === w.id) ? { ...w, color: e.target.value } : w)); }} style={{ width: '28px', height: '28px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} title="自訂導線顏色" />
          </div>

          <button onClick={addTextNode} style={{ borderLeft: '2px solid #ccc', paddingLeft: '15px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: '#0066cc', fontWeight: 'bold' }}>➕ 文字</button>
          
          <div style={{ display: 'flex', gap: '8px', borderLeft: '2px solid #ccc', paddingLeft: '15px' }}>
            <button onClick={() => addDynamicPart('resistor')} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }}>⚡ 電阻</button>
            <button onClick={() => addDynamicPart('ceramic_cap')} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }}>🟡 陶瓷電容</button>
            <button onClick={() => addDynamicPart('led')} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }}>💡 LED</button>
          </div>

          <button onClick={() => { saveSnapshot(); setIsUsbConnected(!isUsbConnected); }} style={{ padding: '5px 15px', background: isUsbConnected ? '#e74c3c' : '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginLeft: '10px' }}>
            {isUsbConnected ? '❌ 拔除 USB' : '🔌 插入 USB'}
          </button>

          {singleSelectedItem.type === 'text' ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#e3f2fd', padding: '5px 10px', borderRadius: '6px', marginLeft: '10px' }}>
              <b>字體:</b>
              <input type="color" value={editingTextColor} onChange={e => { saveSnapshot(); setEditingTextColor(e.target.value); }} />
              <input type="number" value={editingTextSize} onChange={e => { saveSnapshot(); setEditingTextSize(Number(e.target.value)); }} style={{width: '50px'}} />
            </div>
          ) : null}

          {selectedDynamicPart?.partType === 'resistor' ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#fff3e0', border: '1px solid #ffb74d', padding: '5px 10px', borderRadius: '6px', marginLeft: '10px' }}>
              <b style={{color: '#e65100'}}>電阻設定:</b>
              {selectedDynamicPart.bands.map((bandVal, idx) => (
                <select key={idx} value={bandVal} onChange={e => handleResistorBandChange(selectedDynamicPart.instanceId, idx, Number(e.target.value))} style={{ padding: '2px 4px', borderRadius: '4px' }}>
                  {RESISTOR_COLORS.map((color, colorIdx) => <option key={colorIdx} value={colorIdx} disabled={idx === 3 && !color.tol}>{color.name}</option>)}
                </select>
              ))}
              <span style={{ marginLeft: '5px', fontWeight: 'bold', color: '#2c3e50', background: 'white', padding: '2px 6px', borderRadius: '4px', border: '1px solid #ccc' }}>{getResistanceStr(selectedDynamicPart.bands)}</span>
            </div>
          ) : null}

          {selectedDynamicPart?.partType === 'led' ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#ffebee', border: '1px solid #ef5350', padding: '5px 10px', borderRadius: '6px', marginLeft: '10px' }}>
              <b style={{color: '#c62828'}}>LED 顏色:</b>
              <input type="color" value={selectedDynamicPart.color} onChange={e => handleDynamicPropChange(selectedDynamicPart.instanceId, 'color', e.target.value)} />
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <div style={{ color: '#888', fontSize: '14px', marginRight: '10px' }}>
            {selectedItems.length > 1 ? `已選取 ${selectedItems.length} 個物件 (Del)` : singleSelectedItem.id ? `選取中: ${singleSelectedItem.type} (Del)` : '未選取物件'}
          </div>
          
          <div style={{ display: 'flex', gap: '5px', marginRight: '5px' }}>
            <button onClick={handleUndo} disabled={past.length === 0} style={{ padding: '6px 12px', background: past.length === 0 ? '#ccc' : '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: past.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }} title="上一步 (Ctrl+Z)">↶</button>
            <button onClick={handleRedo} disabled={future.length === 0} style={{ padding: '6px 12px', background: future.length === 0 ? '#ccc' : '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: future.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }} title="下一步 (Ctrl+Y)">↷</button>
          </div>

          <button onClick={handleExportImage} style={{ padding: '6px 15px', background: '#9b59b6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🖼️ 匯出</button>
          
          <div style={{ position: 'relative' }}>
            <button 
              onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)} 
              style={{ padding: '6px 15px', background: '#2196F3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              📂 載入專案... ▾
            </button>
            {isProjectDropdownOpen && (
              <>
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} onClick={() => setIsProjectDropdownOpen(false)} />
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '5px', background: 'white', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', zIndex: 1000, width: '260px', maxHeight: '350px', overflowY: 'auto' }}>
                  {savedProjects.length === 0 ? (
                    <div style={{ padding: '15px', textAlign: 'center', color: '#888', fontSize: '14px' }}>無已儲存的專案</div>
                  ) : (
                    savedProjects.map(name => (
                      <div 
                        key={name} 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eee', cursor: 'pointer', transition: 'background 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        onClick={() => { setIsProjectDropdownOpen(false); handleLoadFromCloud(name); }}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', color: '#333' }} title={`載入 ${name}`}>{name}</span>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteProject(name); }} 
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px', marginLeft: '8px', color: '#e74c3c', borderRadius: '4px', transition: 'background 0.2s' }}
                          title={`刪除 ${name}`}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#ffebee'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >❌</button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <button onClick={handleSaveToCloud} style={{ padding: '6px 15px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>☁️ 儲存</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
        
        {/* ================= 左側側邊欄 ================= */}
        {isSidebarOpen ? (
          <div style={{ width: '250px', border: '1px solid #ccc', borderRadius: '8px', padding: '15px', overflowY: 'auto', background: '#fafafa', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ margin: '0 0 5px 0' }}>📦 零件庫 ({library.length})</h3>
            <label style={{ display: 'block', padding: '10px', background: '#fff', border: '2px dashed #bbb', borderRadius: '6px', textAlign: 'center', cursor: 'pointer', color: '#666', fontWeight: 'bold' }}>
              ➕ 匯入元件 (.fzpz)
              <input type="file" accept=".fzpz" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {library.map(t => (
                <div key={t.id} style={{ border: '1px solid #ddd', padding: '10px', borderRadius: '4px', background: 'white', textAlign: 'center', transition: '0.2s', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                  <img src={t.img.src} alt={t.title} onClick={() => addPartToBoard(t)} style={{ maxWidth: '100%', maxHeight: '100px', objectFit: 'contain', cursor: 'pointer' }} />
                  <div style={{ fontSize: '12px', marginTop: '8px', fontWeight: 'bold', color: '#333' }}>{t.title}</div>
                  <button onClick={async () => {
                    try {
                      await deleteDoc(doc(db, 'components', t.id));
                      setLibrary(prev => prev.filter(c => c.id !== t.id));
                      alert(`✅ [${t.title}] 已刪除！`);
                    } catch (error) {
                      console.error('刪除失败:', error);
                      alert('❌ 刪除失败');
                    }
                  }} style={{ marginTop: '8px', padding: '4px 8px', fontSize: '11px', background: '#ff6b6b', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>刪除</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ================= 繪圖主畫布 ================= */}
        <div style={{ flex: 1, border: '2px solid #333', backgroundColor: '#e0e0e0', overflow: 'hidden', position: 'relative' }}>
          {lcdInput.open ? (
            <input
              ref={lcdInputRef}
              value={lcdInput.value}
              onChange={(e) => setLcdInput(prev => ({ ...prev, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setLcdInput({ open: false, partInstanceId: null, value: '', x: 0, y: 0 });
                }
              }}
              onBlur={async () => {
                const snapshot = lcdInput;
                setLcdInput({ open: false, partInstanceId: null, value: '', x: 0, y: 0 });
                if (snapshot.partInstanceId) await updateLcdDisplay(snapshot.partInstanceId, snapshot.value);
              }}
              style={{
                position: 'absolute',
                left: `${lcdInput.x}px`,
                top: `${lcdInput.y}px`,
                zIndex: 20,
                width: '280px',
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid #666',
                outline: 'none'
              }}
              placeholder="輸入 LCD 內容（Enter 確定 / Esc 取消）"
            />
          ) : null}
          <Stage 
            ref={stageRef} width={window.innerWidth - (isSidebarOpen ? 320 : 50)} height={window.innerHeight - 80}
            draggable={false} 
            scaleX={stageConfig.scale} scaleY={stageConfig.scale} x={stageConfig.x} y={stageConfig.y}
            onWheel={handleWheel} 
            onContextMenu={(e) => e.evt.preventDefault()}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove} 
            onMouseUp={handleStageMouseUp} 
            onMouseLeave={handleStageMouseUp} 
          >
            <Layer>
              <Group 
                id="breadboard-group" x={boardPos.x} y={boardPos.y} draggable 
                onDragStart={handleBoardDragStart} onDragMove={handleBoardDragMove} onDragEnd={handleBoardDragEnd} onClick={(e) => handleItemClick(e, 'breadboard', 'board')}
              >
                <Rect width={bbLayout.width} height={bbLayout.height} fill="#ffffff" cornerRadius={6} shadowBlur={selectedItems.some(s => s.id === 'breadboard') ? 15 : 5} shadowColor={selectedItems.some(s => s.id === 'breadboard') ? 'blue' : 'black'} />
                {bbLayout.segmentLefts.map((left, segIdx) => (
                  <Group key={`bb-seg-${segIdx}`} listening={false}>
                    <Rect x={left + 9.5 * GRID_SIZE} y={0} width={5 * GRID_SIZE} height={bbLayout.segmentHeight} fill="#f0f0f0" />
                    {['a','b','c','d','e'].map((letter, i) => <Text key={`${segIdx}-${letter}`} x={left + (i+4.5)*GRID_SIZE - 4} y={6} text={letter} fontSize={10} fill="#888" fontStyle="bold" />)}
                    {['f','g','h','i','j'].map((letter, i) => <Text key={`${segIdx}-r-${letter}`} x={left + (i+15.5)*GRID_SIZE - 4} y={6} text={letter} fontSize={10} fill="#888" fontStyle="bold" />)}
                    {Array.from({length: bbRows}).map((_, i) => <Text key={`row-${segIdx}-${i}`} x={left + 3.2 * GRID_SIZE} y={(i+1)*GRID_SIZE - 5} text={i+1} fontSize={10} fill="#888" />)}
                    {Array.from({length: bbRows}).map((_, i) => <Text key={`row2-${segIdx}-${i}`} x={left + 20.2 * GRID_SIZE} y={(i+1)*GRID_SIZE - 5} text={i+1} fontSize={10} fill="#888" />)}
                    <Line points={[left + 1 * GRID_SIZE, GRID_SIZE, left + 1 * GRID_SIZE, bbLayout.segmentHeight - GRID_SIZE]} stroke="red" strokeWidth={2} opacity={0.5} />
                    <Line points={[left + 3 * GRID_SIZE, GRID_SIZE, left + 3 * GRID_SIZE, bbLayout.segmentHeight - GRID_SIZE]} stroke="blue" strokeWidth={2} opacity={0.5} />
                    <Line points={[left + 21 * GRID_SIZE, GRID_SIZE, left + 21 * GRID_SIZE, bbLayout.segmentHeight - GRID_SIZE]} stroke="blue" strokeWidth={2} opacity={0.5} />
                    <Line points={[left + 23 * GRID_SIZE, GRID_SIZE, left + 23 * GRID_SIZE, bbLayout.segmentHeight - GRID_SIZE]} stroke="red" strokeWidth={2} opacity={0.5} />
                  </Group>
                ))}
                
                <Group listening={true}>
                  {bbLayout.holes.map((hole, i) => (
                    <Circle 
                      key={`hole-${i}`} x={hole.x} y={hole.y} radius={2.5} fill={hole.color} stroke="transparent" strokeWidth={10} 
                      onMouseEnter={handlePinMouseEnter} onMouseLeave={handlePinMouseLeave} onMouseDown={handleStartWire} 
                    />
                  ))}
                </Group>
              </Group>

              {wires.map(wire => (
                <Group key={wire.id}>
                  <Path 
                    data={getRoundedPath(wire.points, 8)} stroke={selectedItems.some(s => s.id === wire.id) ? '#00e5ff' : wire.color} 
                    strokeWidth={selectedItems.some(s => s.id === wire.id) ? 6 : 4} hitStrokeWidth={15} lineCap="round" lineJoin="round" shadowBlur={selectedItems.some(s => s.id === wire.id) ? 10 : 2} 
                    onClick={(e) => handleItemClick(e, wire.id, 'wire')} onDblClick={(e) => handleWireDblClick(e, wire.id)} 
                    onMouseEnter={(e) => e.target.getStage().container().style.cursor = 'pointer'} onMouseLeave={(e) => e.target.getStage().container().style.cursor = 'default'}
                  />
                  {(selectedItems.some(s => s.id === wire.id) && wire.points.length > 4) ? (
                    Array.from({ length: (wire.points.length - 4) / 2 }).map((_, i) => {
                      const idx = (i + 1) * 2;
                      return (
                        <Circle 
                          key={idx} x={wire.points[idx]} y={wire.points[idx + 1]} radius={6} fill="#ffffff" stroke={wire.color} strokeWidth={3} draggable
                          onDragStart={(e) => { if (e.evt.button === 2) { e.target.stopDrag(); return; } saveSnapshot(); }}
                          onClick={e => e.cancelBubble = true} onDblClick={(e) => handleJointDblClick(e, wire.id, idx)} 
                          onDragMove={(e) => handleJointDragMove(e, wire.id, idx)} onDragEnd={(e) => handleJointDragEnd(e, wire.id, idx)}
                          onMouseEnter={(e) => e.target.getStage().container().style.cursor = 'grab'} onMouseLeave={(e) => e.target.getStage().container().style.cursor = 'pointer'}
                        />
                      )
                    })
                  ) : null}
                </Group>
              ))}

              {boardParts.map(part => (
                <Group 
                  key={part.instanceId} x={part.x} y={part.y} rotation={part.rotation} offset={{ x: part.width / 2, y: part.height / 2 }} draggable 
                  onDragStart={(e) => handlePartDragStart(e, part.instanceId)}
                  onClick={(e) => handleItemClick(e, part.instanceId, 'part')} 
                  onDblClick={(e) => openLcdEditor(part, e)}
                  
                  // 右鍵旋轉時：導線跟隨 + 優先以引腳貼齊麵包板洞位
                  onContextMenu={(e) => { 
                    e.evt.preventDefault(); 
                    if (hasPanned.current) return; 
                    
                    saveSnapshot();
                    const globalPins = getPartGlobalPins(part);
                    const connections = [];
                    wires.forEach(w => {
                      globalPins.forEach(gPin => {
                        if (Math.hypot(w.points[0] - gPin.gx, w.points[1] - gPin.gy) < 5) connections.push({ wireId: w.id, pointIndex: 0, pinId: gPin.id });
                        const lastIdx = w.points.length - 2;
                        if (Math.hypot(w.points[lastIdx] - gPin.gx, w.points[lastIdx+1] - gPin.gy) < 5) connections.push({ wireId: w.id, pointIndex: lastIdx, pinId: gPin.id });
                      });
                    });

                    const newRot = (part.rotation + 90) % 360;
                    
                    let newX = part.x;
                    let newY = part.y;
                    // 當旋轉到垂直狀態時，自動偏移 7.5 像素對齊網格
                    if (newRot % 180 !== 0) {
                      newX = Math.round((part.x - GRID_SIZE/2) / GRID_SIZE) * GRID_SIZE + GRID_SIZE/2;
                      newY = Math.round((part.y - GRID_SIZE/2) / GRID_SIZE) * GRID_SIZE + GRID_SIZE/2;
                    } else {
                      newX = Math.round(part.x / GRID_SIZE) * GRID_SIZE;
                      newY = Math.round(part.y / GRID_SIZE) * GRID_SIZE;
                    }
                    
                    const preAlignedPart = { ...part, rotation: newRot, x: newX, y: newY };
                    const alignedAfterRotate = alignPartPinsToBreadboard(preAlignedPart);
                    const updatedPart = alignedAfterRotate.snapped
                      ? { ...preAlignedPart, x: alignedAfterRotate.x, y: alignedAfterRotate.y }
                      : preAlignedPart;
                    setBoardParts(prev => prev.map(p => p.instanceId === part.instanceId ? updatedPart : p)); 
                    
                    if (connections.length > 0) {
                      const newGlobalPins = getPartGlobalPins(updatedPart);
                      setWires(prevWires => prevWires.map(w => {
                        const bindings = connections.filter(b => b.wireId === w.id);
                        if (bindings.length === 0) return w;
                        const newPoints = [...w.points];
                        bindings.forEach(b => {
                          const gPin = newGlobalPins.find(p => p.id === b.pinId);
                          if (gPin) { newPoints[b.pointIndex] = gPin.gx; newPoints[b.pointIndex + 1] = gPin.gy; }
                        });
                        return { ...w, points: newPoints };
                      }));
                    }
                  }} 
                  onDragMove={(e) => handlePartDragMove(e, part.instanceId)} 
                  onDragEnd={(e) => handleItemDragEnd(e, part.instanceId, 'part')}
                >
                  {renderPartGraphics(part, selectedItems.some(s => s.id === part.instanceId))}
                  
                  {part.pins.map(pin => (
                    <Circle 
                      key={pin.id} x={pin.x} y={pin.y} radius={2.5} fill="rgba(0,0,0,0)" stroke="transparent" strokeWidth={10} 
                      onMouseEnter={handlePinMouseEnter} onMouseLeave={handlePinMouseLeave} onMouseDown={handleStartWire}   
                    />
                  ))}
                </Group>
              ))}

              {isUsbConnected ? boardParts.map(part => {
                if (part.title && part.title.includes("Pico")) {
                  const usbOffsetX = 0; const usbOffsetY = -part.height / 2 + 11; const rad = part.rotation * Math.PI / 180;
                  const rotatedUsbX = usbOffsetX * Math.cos(rad) - usbOffsetY * Math.sin(rad); const rotatedUsbY = usbOffsetX * Math.sin(rad) + usbOffsetY * Math.cos(rad);
                  const finalUsbX = part.x + rotatedUsbX; const finalUsbY = part.y + rotatedUsbY;
                  const backUsbX = finalUsbX + 80 * Math.sin(rad); const backUsbY = finalUsbY - 80 * Math.cos(rad);
                  const startX = (-stageConfig.x + 20) / stageConfig.scale; const startY = (-stageConfig.y + 20) / stageConfig.scale;
                  const midX = (startX + backUsbX) / 2 + 90; const midY = (startY + backUsbY) / 2 - 40;

                  return (
                    <Group key={`usb-group-${part.instanceId}`}>
                      <Line points={[startX, startY, midX, midY, backUsbX, backUsbY]} stroke="#444444" strokeWidth={15} tension={0.5} lineCap="round" listening={false} opacity={0.9} />
                      <Group x={finalUsbX} y={finalUsbY} rotation={part.rotation} listening={false}>
                        <Rect x={-15} y={-80} width={30} height={30} fill="#222222" cornerRadius={4} />
                        <Rect x={-25} y={-60} width={50} height={60} fill="#333333" cornerRadius={[4, 4, 0, 0]} />
                        <Rect x={-10} y={-30} width={20} height={15} fill="#222222" cornerRadius={2} />
                      </Group>
                    </Group>
                  );
                }
                return null;
              }) : null}

              {drawingWire ? <Line points={[drawingWire.startX, drawingWire.startY, drawingWire.endX, drawingWire.endY]} stroke={drawingWire.color} strokeWidth={4} opacity={0.6} lineCap="round" listening={false} /> : null}

              {texts.map(t => (
                <Text 
                  key={t.id} x={t.x} y={t.y} text={t.text} fontSize={t.fontSize} fill={t.color} draggable shadowBlur={selectedItems.some(s => s.id === t.id) ? 10 : 0} shadowColor="blue" 
                  onDragStart={(e) => { if (e.evt.button === 2) { e.target.stopDrag(); return; } saveSnapshot(); }}
                  onClick={(e) => handleItemClick(e, t.id, 'text')} onDblClick={(e) => { const newText = window.prompt("請輸入文字:", t.text); if (newText !== null && newText !== t.text) { saveSnapshot(); setTexts(prev => prev.map(item => item.id === t.id ? { ...item, text: newText } : item)); } }} 
                  onDragMove={(e) => handleTextDragMove(e, t.id)} onDragEnd={(e) => handleItemDragEnd(e, t.id, 'text')} 
                  onMouseEnter={(e) => e.target.getStage().container().style.cursor = 'text'} onMouseLeave={(e) => e.target.getStage().container().style.cursor = 'default'} 
                />
              ))}

              {/* ✅ 繪製左鍵選取框 */}
              {selectionRect ? (
                <Rect
                  x={selectionRect.width >= 0 ? selectionRect.startX : selectionRect.startX + selectionRect.width}
                  y={selectionRect.height >= 0 ? selectionRect.startY : selectionRect.startY + selectionRect.height}
                  width={Math.abs(selectionRect.width)}
                  height={Math.abs(selectionRect.height)}
                  fill="rgba(0, 161, 255, 0.3)"
                  stroke="#00A1FF"
                  strokeWidth={1}
                  listening={false}
                />
              ) : null}

              {/* ✅ 水印 - 固定在面包板右下角，不随缩放 */}
              <Group
                x={boardPos.x + bbLayout.width - 310}
                y={boardPos.y + bbLayout.height - 35}
                listening={false}
              >
                <Rect
                  x={0}
                  y={0}
                  width={310}
                  height={35}
                  fill="rgba(128, 128, 128, 0.6)"
                  cornerRadius={6}
                />
                <Text
                  x={8}
                  y={8}
                  text="copyright © 2026 NCYU OFC Lab"
                  fontSize={20}
                  fontFamily="'Times New Roman'"
                  fill="#FFFFFF"
                  fontStyle="bold"
                  width={300}
                />
              </Group>
            </Layer>
          </Stage>
        </div>
      </div>
      
      {/* ================= 提示小抄 ================= */}
      <div style={{ position: 'fixed', top: '150px', right: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
        {isTipsOpen ? (
          <div style={{ background: 'rgba(255,255,255,0.95)', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', fontSize: '13px', lineHeight: '1.8', border: '1px solid #ddd' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#2c3e50', fontSize: '14px' }}>💡 專業操作提示</div>
            <div>🟦 <b>左鍵拖曳</b>：拉框多重選取元件</div>
            <div>🖐️ <b>右鍵拖曳</b>：自由平移畫布</div>
            <div>🟩 <b>點擊洞口拖曳</b>：建立導線</div>
            <div>⚡ <b>雙擊導線</b>：新增彎折節點</div>
            <div>❌ <b>雙擊節點</b>：刪除該轉折點</div>
            <div>🔄 <b>右鍵點擊零件</b>：旋轉 90 度 (導線會自動跟隨)</div>
          </div>
        ) : null}
        <button 
          onClick={() => setIsTipsOpen(!isTipsOpen)}
          style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: isTipsOpen ? '#e74c3c' : '#3498db', color: 'white', border: 'none', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'center', alignItems: 'center', outline: 'none', padding: 0 }}
        >
          {isTipsOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          )}
        </button>
      </div>
    </div>
  );
}

export default App;