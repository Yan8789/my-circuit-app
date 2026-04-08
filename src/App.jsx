import { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Rect, Line, Text } from 'react-konva';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

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
  const [boardPos, setBoardPos] = useState({ x: GRID_SIZE * 4, y: GRID_SIZE * 4 });
  const [wireColor, setWireColor] = useState('#ff0000'); 
  const [drawingWire, setDrawingWire] = useState(null); 
  const [isUsbConnected, setIsUsbConnected] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTipsOpen, setIsTipsOpen] = useState(false);

  const [selectedItems, setSelectedItems] = useState([]); 
  const [selectionRect, setSelectionRect] = useState(null); 
  const [isPanning, setIsPanning] = useState(false); 
  const lastPanPos = useRef({ x: 0, y: 0 });
  const hasPanned = useRef(false);

  const draggingPartConnections = useRef([]);

  const hoveredPinRef = useRef(null);
  const stageRef = useRef(null);

  const [editingTextColor, setEditingTextColor] = useState('#333333');
  const [editingTextSize, setEditingTextSize] = useState(24);

  const singleSelectedItem = selectedItems.length === 1 ? selectedItems[0] : { id: null, type: null };

  useEffect(() => {
    if (singleSelectedItem.type === 'text') {
      setTexts(prev => prev.map(t => t.id === singleSelectedItem.id ? { ...t, color: editingTextColor, fontSize: editingTextSize } : t));
    }
  }, [editingTextColor, editingTextSize]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItems.length > 0) {
          setWires(prev => prev.filter(w => !selectedItems.some(s => s.id === w.id)));
          setBoardParts(prev => prev.filter(p => !selectedItems.some(s => s.id === p.instanceId)));
          setTexts(prev => prev.filter(t => !selectedItems.some(s => s.id === t.id)));
          setSelectedItems([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems]);

  const handleSaveToCloud = async () => {
    const projectName = window.prompt("☁️ 請為您的電路專案命名：", "Pico_Project_01");
    if (!projectName) return; 
    const projectData = {
      library: library.map(({ img, ...rest }) => rest), 
      boardParts: boardParts.map(({ img, ...rest }) => rest),
      wires, texts, bbRows, boardPos, isUsbConnected 
    };
    try {
      await setDoc(doc(db, "projects", projectName), projectData);
      alert(`✅ 專案 [${projectName}] 已成功儲存！`);
    } catch (error) { alert("❌ 儲存失敗！"); }
  };

  const handleLoadFromCloud = async () => {
    const projectName = window.prompt("☁️ 請輸入要讀取的專案名稱：", "Pico_Project_01");
    if (!projectName) return;
    if (!window.confirm(`即將從雲端載入 [${projectName}]，這會覆蓋目前的畫布，確定嗎？`)) return;
    try {
      const docSnap = await getDoc(doc(db, "projects", projectName));
      if (docSnap.exists()) {
        const data = docSnap.data();
        const rebuiltLibrary = await Promise.all(data.library.map(async item => {
          const img = new window.Image();
          img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(item.svgContent)));
          await new Promise(resolve => { img.onload = resolve; });
          return { ...item, img };
        }));
        const rebuiltParts = data.boardParts.map(part => {
          if (['resistor', 'ceramic_cap', 'led'].includes(part.partType)) return part; 
          const libItem = rebuiltLibrary.find(l => l.id === part.id);
          return { ...part, img: libItem ? libItem.img : null };
        });
        setLibrary(rebuiltLibrary); setBoardParts(rebuiltParts); setWires(data.wires || []); setTexts(data.texts || []);
        setBbRows(data.bbRows || 30); setBoardPos(data.boardPos || { x: GRID_SIZE * 4, y: GRID_SIZE * 4 });
        setIsUsbConnected(data.isUsbConnected || false); setSelectedItems([]);
        alert(`✅ 成功載入！`);
      } else alert(`❌ 找不到專案！`);
    } catch (error) { console.error("讀取失敗：", error); }
  };

  const handleExportImage = () => {
    setSelectedItems([]); 
    setTimeout(() => {
      if (stageRef.current) {
        const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 }); 
        const link = document.createElement('a'); link.href = dataURL; link.download = `Circuit_${Date.now()}.png`; link.click();
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
      img.onload = () => {
        const extractedPins = [];
        connectors.forEach(conn => {
          if (!conn.svgId) return; const el = svgDoc.getElementById(conn.svgId);
          if (el) {
            let x = parseFloat(el.getAttribute('cx') || el.getAttribute('x') || 0); let y = parseFloat(el.getAttribute('cy') || el.getAttribute('y') || 0);
            if (el.tagName.toLowerCase() === 'rect') { x += parseFloat(el.getAttribute('width') || 0) / 2; y += parseFloat(el.getAttribute('height') || 0) / 2; }
            extractedPins.push({ id: conn.id, name: conn.name, x: x * (img.width / vbWidth) * DPI_SCALE, y: y * (img.height / vbHeight) * DPI_SCALE });
          }
        });
        setLibrary(prev => [...prev, { id: Date.now().toString(), title, svgContent, img, pins: extractedPins, width: img.width * DPI_SCALE, height: img.height * DPI_SCALE }]);
      };
    } catch (error) { console.error("解析失敗:", error); }
    event.target.value = null; 
  };

  const addPartToBoard = (template) => {
    const centerX = (-stageConfig.x + window.innerWidth / 2) / stageConfig.scale;
    const centerY = (-stageConfig.y + window.innerHeight / 2) / stageConfig.scale;
    setBoardParts(prev => [...prev, { ...template, instanceId: Date.now().toString(), x: Math.round(centerX/GRID_SIZE)*GRID_SIZE, y: Math.round(centerY/GRID_SIZE)*GRID_SIZE, rotation: 0 }]);
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
    setBoardParts(prev => [...prev, newPart]);
  };

  const handleDynamicPropChange = (id, propName, value) => {
    setBoardParts(prev => prev.map(p => (p.instanceId === id ? { ...p, [propName]: value } : p)));
  };

  const handleResistorBandChange = (id, bandIdx, colorIdx) => {
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
      const endPoint = hoveredPinRef.current;
      setWires(prev => [...prev, { id: Date.now().toString(), points: [drawingWire.startX, drawingWire.startY, endPoint.x, endPoint.y], color: drawingWire.color }]);
    }
    setDrawingWire(null); hoveredPinRef.current = null;
  };

  const boardDragStartPos = useRef({ x: 0, y: 0 }); const initialPartsPos = useRef([]); const initialWiresPos = useRef([]);

  const handleBoardDragStart = (e) => {
    if (e.evt.button === 2) { e.target.stopDrag(); return; }
    if (e.target.id() !== 'breadboard-group' && e.target.nodeType !== 'Rect' && e.target.nodeType !== 'Text') return;
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
  
  // 🎯 重點修復：依照旋轉角度決定網格相位的智慧吸附系統
  const handleItemDragEnd = (e, id, type) => {
    if (type === 'text') { setTexts(prev => prev.map(t => t.id === id ? { ...t, x: Math.round(e.target.x()/GRID_SIZE)*GRID_SIZE, y: Math.round(e.target.y()/GRID_SIZE)*GRID_SIZE } : t)); return; }
    
    if (type === 'part') {
      const part = boardParts.find(p => p.instanceId === id);
      if (!part) return;

      let snappedX, snappedY;
      
      // 如果元件旋轉了 90 或 270 度，中心點必須偏移半格 (GRID_SIZE/2) 才能讓引腳對齊洞口
      if (part.rotation % 180 !== 0) {
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
  };

  const addTextNode = () => {
    const centerX = (-stageConfig.x + window.innerWidth / 2) / stageConfig.scale; const centerY = (-stageConfig.y + window.innerHeight / 2) / stageConfig.scale;
    setTexts(prev => [...prev, { id: Date.now().toString(), x: centerX, y: centerY - 100, text: '雙擊以編輯文字', fontSize: 24, color: '#333333' }]);
  };

  const generateBreadboard = () => {
    const holes = []; const width = 24 * GRID_SIZE; const height = (bbRows + 2) * GRID_SIZE;
    for (let row = 0; row < bbRows; row++) {
      const y = (row + 1) * GRID_SIZE;
      holes.push({ x: 1.5 * GRID_SIZE, y, type: 'power', color: '#ff4444' }); holes.push({ x: 2.5 * GRID_SIZE, y, type: 'power', color: '#4444ff' }); 
      for (let c = 4.5; c <= 8.5; c++) holes.push({ x: c * GRID_SIZE, y, type: 'terminal', color: '#555' }); 
      for (let c = 15.5; c <= 19.5; c++) holes.push({ x: c * GRID_SIZE, y, type: 'terminal', color: '#555' }); 
      holes.push({ x: 21.5 * GRID_SIZE, y, type: 'power', color: '#4444ff' }); holes.push({ x: 22.5 * GRID_SIZE, y, type: 'power', color: '#ff4444' }); 
    }
    return { width, height, holes };
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
            <b>排數:</b><input type="number" value={bbRows} onChange={e => setBbRows(Number(e.target.value))} style={{width: '60px'}} />
          </div>

          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', borderLeft: '2px solid #ccc', paddingLeft: '15px' }}>
            <b>導線:</b>
            {['#ff0000', '#000000', '#0000ff', '#00ff00', '#ffff00'].map(c => (
              <div key={c} onClick={() => setWireColor(c)} style={{ width: '20px', height: '20px', backgroundColor: c, border: wireColor === c ? '3px solid #333' : '1px solid #ccc', cursor: 'pointer', borderRadius: '50%' }} />
            ))}
          </div>

          <button onClick={addTextNode} style={{ borderLeft: '2px solid #ccc', paddingLeft: '15px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: '#0066cc', fontWeight: 'bold' }}>➕ 文字</button>
          
          <div style={{ display: 'flex', gap: '8px', borderLeft: '2px solid #ccc', paddingLeft: '15px' }}>
            <button onClick={() => addDynamicPart('resistor')} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }}>⚡ 電阻</button>
            <button onClick={() => addDynamicPart('ceramic_cap')} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }}>🟡 陶瓷電容</button>
            <button onClick={() => addDynamicPart('led')} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', padding: '4px 8px', fontSize: '13px' }}>💡 LED</button>
          </div>

          <button onClick={() => setIsUsbConnected(!isUsbConnected)} style={{ padding: '5px 15px', background: isUsbConnected ? '#e74c3c' : '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginLeft: '10px' }}>
            {isUsbConnected ? '❌ 拔除 USB' : '🔌 插入 USB'}
          </button>

          {singleSelectedItem.type === 'text' ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#e3f2fd', padding: '5px 10px', borderRadius: '6px', marginLeft: '10px' }}>
              <b>字體:</b>
              <input type="color" value={editingTextColor} onChange={e => setEditingTextColor(e.target.value)} />
              <input type="number" value={editingTextSize} onChange={e => setEditingTextSize(Number(e.target.value))} style={{width: '50px'}} />
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
          <button onClick={handleExportImage} style={{ padding: '6px 15px', background: '#9b59b6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🖼️ 匯出</button>
          <button onClick={handleLoadFromCloud} style={{ padding: '6px 15px', background: '#2196F3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📂 讀取</button>
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
                <div key={t.id} onClick={() => addPartToBoard(t)} style={{ border: '1px solid #ddd', padding: '10px', borderRadius: '4px', cursor: 'pointer', background: 'white', textAlign: 'center', transition: '0.2s', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                  <img src={t.img.src} alt={t.title} style={{ maxWidth: '100%', maxHeight: '100px', objectFit: 'contain' }} />
                  <div style={{ fontSize: '12px', marginTop: '8px', fontWeight: 'bold', color: '#333' }}>{t.title}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ================= 繪圖主畫布 ================= */}
        <div style={{ flex: 1, border: '2px solid #333', backgroundColor: '#e0e0e0', overflow: 'hidden', position: 'relative' }}>
          <Stage 
            ref={stageRef} width={window.innerWidth - (isSidebarOpen ? 320 : 50)} height={window.innerHeight - 150}
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
                <Rect x={9.5 * GRID_SIZE} y={0} width={5 * GRID_SIZE} height={bbLayout.height} fill="#f0f0f0" />
                {['a','b','c','d','e'].map((letter, i) => <Text key={letter} x={(i+4.5)*GRID_SIZE - 4} y={6} text={letter} fontSize={10} fill="#888" fontStyle="bold" />)}
                {['f','g','h','i','j'].map((letter, i) => <Text key={letter} x={(i+15.5)*GRID_SIZE - 4} y={6} text={letter} fontSize={10} fill="#888" fontStyle="bold" />)}
                {Array.from({length: bbRows}).map((_, i) => <Text key={`row-${i}`} x={3.2 * GRID_SIZE} y={(i+1)*GRID_SIZE - 5} text={i+1} fontSize={10} fill="#888" />)}
                {Array.from({length: bbRows}).map((_, i) => <Text key={`row2-${i}`} x={20.2 * GRID_SIZE} y={(i+1)*GRID_SIZE - 5} text={i+1} fontSize={10} fill="#888" />)}
                <Line points={[1 * GRID_SIZE, GRID_SIZE, 1 * GRID_SIZE, bbLayout.height - GRID_SIZE]} stroke="red" strokeWidth={2} opacity={0.5} />
                <Line points={[3 * GRID_SIZE, GRID_SIZE, 3 * GRID_SIZE, bbLayout.height - GRID_SIZE]} stroke="blue" strokeWidth={2} opacity={0.5} />
                <Line points={[21 * GRID_SIZE, GRID_SIZE, 21 * GRID_SIZE, bbLayout.height - GRID_SIZE]} stroke="blue" strokeWidth={2} opacity={0.5} />
                <Line points={[23 * GRID_SIZE, GRID_SIZE, 23 * GRID_SIZE, bbLayout.height - GRID_SIZE]} stroke="red" strokeWidth={2} opacity={0.5} />
                
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
                  <Line 
                    points={wire.points} tension={0.5} stroke={selectedItems.some(s => s.id === wire.id) ? '#00e5ff' : wire.color} 
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
                          onDragStart={(e) => { if (e.evt.button === 2) e.target.stopDrag(); }}
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
                  
                  // 🎯 重點修復：右鍵旋轉也會啟動智慧相位偏移，並帶著導線一起轉！
                  onContextMenu={(e) => { 
                    e.evt.preventDefault(); 
                    if (hasPanned.current) return; 
                    
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
                    
                    const updatedPart = { ...part, rotation: newRot, x: newX, y: newY };
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
                  onDragStart={(e) => { if (e.evt.button === 2) e.target.stopDrag(); }}
                  onClick={(e) => handleItemClick(e, t.id, 'text')} onDblClick={(e) => { const newText = window.prompt("請輸入文字:", t.text); if (newText !== null) setTexts(prev => prev.map(item => item.id === t.id ? { ...item, text: newText } : item)); }} 
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
            </Layer>
          </Stage>
        </div>
      </div>
      
      {/* ================= 提示小抄 ================= */}
      <div style={{ position: 'fixed', bottom: '20px', right: '30px', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
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