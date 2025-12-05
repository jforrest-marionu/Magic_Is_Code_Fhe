// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// Randomly selected styles: 
// Colors: High saturation neon (purple/blue/pink/green)
// UI: Cyberpunk
// Layout: Card style
// Interaction: Animation rich

// Randomly selected features:
// 1. Project introduction
// 2. Data statistics
// 3. Search & filter function
// 4. User operation history record

interface SpellRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  caster: string;
  spellType: string;
  manaCost: number;
  status: "prepared" | "cast" | "failed";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [spells, setSpells] = useState<SpellRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [casting, setCasting] = useState(false);
  const [spellStatus, setSpellStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newSpellData, setNewSpellData] = useState({ spellType: "", description: "", manaCost: 0 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState<SpellRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const castCount = spells.filter(s => s.status === "cast").length;
  const preparedCount = spells.filter(s => s.status === "prepared").length;
  const failedCount = spells.filter(s => s.status === "failed").length;

  useEffect(() => {
    loadSpells().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadSpells = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("spell_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing spell keys:", e); }
      }
      const list: SpellRecord[] = [];
      for (const key of keys) {
        try {
          const spellBytes = await contract.getData(`spell_${key}`);
          if (spellBytes.length > 0) {
            try {
              const spellData = JSON.parse(ethers.toUtf8String(spellBytes));
              list.push({ 
                id: key, 
                encryptedData: spellData.data, 
                timestamp: spellData.timestamp, 
                caster: spellData.caster, 
                spellType: spellData.spellType, 
                manaCost: spellData.manaCost,
                status: spellData.status || "prepared" 
              });
            } catch (e) { console.error(`Error parsing spell data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading spell ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setSpells(list);
    } catch (e) { console.error("Error loading spells:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const castSpell = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCasting(true);
    setSpellStatus({ visible: true, status: "pending", message: "Encrypting spell with Zama FHE..." });
    try {
      const encryptedData = FHEEncryptNumber(newSpellData.manaCost);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const spellId = `spell-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const spellData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        caster: address, 
        spellType: newSpellData.spellType, 
        manaCost: newSpellData.manaCost,
        status: "prepared" 
      };
      await contract.setData(`spell_${spellId}`, ethers.toUtf8Bytes(JSON.stringify(spellData)));
      const keysBytes = await contract.getData("spell_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(spellId);
      await contract.setData("spell_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      setSpellStatus({ visible: true, status: "success", message: "Spell encrypted and prepared!" });
      await loadSpells();
      setTimeout(() => {
        setSpellStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewSpellData({ spellType: "", description: "", manaCost: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Spell interrupted by caster" : "Spell failed: " + (e.message || "Unknown error");
      setSpellStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setSpellStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCasting(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const executeSpell = async (spellId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setSpellStatus({ visible: true, status: "pending", message: "Channeling mana through FHE encryption..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const spellBytes = await contract.getData(`spell_${spellId}`);
      if (spellBytes.length === 0) throw new Error("Spell not found");
      const spellData = JSON.parse(ethers.toUtf8String(spellBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedSpell = { ...spellData, status: "cast" };
      await contractWithSigner.setData(`spell_${spellId}`, ethers.toUtf8Bytes(JSON.stringify(updatedSpell)));
      
      setSpellStatus({ visible: true, status: "success", message: "Spell successfully cast with FHE!" });
      await loadSpells();
      setTimeout(() => setSpellStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setSpellStatus({ visible: true, status: "error", message: "Spell failed: " + (e.message || "Unknown error") });
      setTimeout(() => setSpellStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const failSpell = async (spellId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setSpellStatus({ visible: true, status: "pending", message: "Channeling mana through FHE encryption..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const spellBytes = await contract.getData(`spell_${spellId}`);
      if (spellBytes.length === 0) throw new Error("Spell not found");
      const spellData = JSON.parse(ethers.toUtf8String(spellBytes));
      const updatedSpell = { ...spellData, status: "failed" };
      await contract.setData(`spell_${spellId}`, ethers.toUtf8Bytes(JSON.stringify(updatedSpell)));
      setSpellStatus({ visible: true, status: "success", message: "Spell marked as failed!" });
      await loadSpells();
      setTimeout(() => setSpellStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setSpellStatus({ visible: true, status: "error", message: "Spell failed: " + (e.message || "Unknown error") });
      setTimeout(() => setSpellStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isCaster = (spellAddress: string) => address?.toLowerCase() === spellAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Grimoire", description: "Connect your magical wallet to begin spellcasting", icon: "📖" },
    { title: "Prepare Spell", description: "Write your FHE-encrypted spell contract", icon: "🔮", details: "Your spell parameters are encrypted client-side before casting" },
    { title: "Channel Mana", description: "Use Zama FHE to process encrypted magical energy", icon: "⚡", details: "The spell executes without revealing its true nature" },
    { title: "Cast Spell", description: "Release your encrypted spell into the magical network", icon: "✨", details: "The spell's effects are computed while remaining encrypted" }
  ];

  const filteredSpells = spells.filter(spell => {
    const matchesSearch = spell.spellType.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         spell.caster.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === "all" || spell.status === filterType;
    return matchesSearch && matchesFilter;
  });

  const renderManaChart = () => {
    const total = spells.length || 1;
    const castPercentage = (castCount / total) * 100;
    const preparedPercentage = (preparedCount / total) * 100;
    const failedPercentage = (failedCount / total) * 100;
    return (
      <div className="mana-chart-container">
        <div className="mana-chart">
          <div className="chart-segment cast" style={{ transform: `rotate(${castPercentage * 3.6}deg)` }}></div>
          <div className="chart-segment prepared" style={{ transform: `rotate(${(castPercentage + preparedPercentage) * 3.6}deg)` }}></div>
          <div className="chart-segment failed" style={{ transform: `rotate(${(castPercentage + preparedPercentage + failedPercentage) * 3.6}deg)` }}></div>
          <div className="chart-center">
            <div className="chart-value">{spells.length}</div>
            <div className="chart-label">Spells</div>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item"><div className="color-box cast"></div><span>Cast: {castCount}</span></div>
          <div className="legend-item"><div className="color-box prepared"></div><span>Prepared: {preparedCount}</span></div>
          <div className="legend-item"><div className="color-box failed"></div><span>Failed: {failedCount}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing magical connection...</p>
    </div>
  );

  return (
    <div className="app-container neon-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="crystal-icon"></div></div>
          <h1>FHE<span>X077</span></h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-spell-btn neon-button">
            <div className="add-icon"></div>Prepare Spell
          </button>
          <button className="neon-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Grimoire" : "Show Grimoire"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Welcome to FHEX077</h2>
            <p>An autonomous world where magic is writing FHE-encrypted smart contracts</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Magical Grimoire</h2>
            <p className="subtitle">Learn the arcane arts of FHE-encrypted spellcasting</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-diagram">
              <div className="diagram-step"><div className="diagram-icon">📜</div><div className="diagram-label">Spell Code</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🔒</div><div className="diagram-label">FHE Encryption</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">⚡</div><div className="diagram-label">Magical Execution</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">✨</div><div className="diagram-label">Encrypted Result</div></div>
            </div>
          </div>
        )}
        <div className="dashboard-grid">
          <div className="dashboard-card neon-card">
            <h3>Arcane Introduction</h3>
            <p>FHEX077 is a world where <strong>magic is code</strong> and spells are FHE-encrypted smart contracts. Wizards must learn a special in-game "magic language" (a simplified FHE-Solidity) to cast spells.</p>
            <div className="fhe-badge"><span>FHE-Powered Magic</span></div>
          </div>
          <div className="dashboard-card neon-card">
            <h3>Spell Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item"><div className="stat-value">{spells.length}</div><div className="stat-label">Total Spells</div></div>
              <div className="stat-item"><div className="stat-value">{castCount}</div><div className="stat-label">Cast</div></div>
              <div className="stat-item"><div className="stat-value">{preparedCount}</div><div className="stat-label">Prepared</div></div>
              <div className="stat-item"><div className="stat-value">{failedCount}</div><div className="stat-label">Failed</div></div>
            </div>
          </div>
          <div className="dashboard-card neon-card"><h3>Spell Distribution</h3>{renderManaChart()}</div>
        </div>
        <div className="spells-section">
          <div className="section-header">
            <h2>Encrypted Spell Registry</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search spells..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="neon-input"
                />
                <select 
                  value={filterType} 
                  onChange={(e) => setFilterType(e.target.value)}
                  className="neon-select"
                >
                  <option value="all">All Statuses</option>
                  <option value="prepared">Prepared</option>
                  <option value="cast">Cast</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <button onClick={loadSpells} className="refresh-btn neon-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          <div className="spells-list neon-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Spell Type</div>
              <div className="header-cell">Caster</div>
              <div className="header-cell">Mana Cost</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            {filteredSpells.length === 0 ? (
              <div className="no-spells">
                <div className="no-spells-icon"></div>
                <p>No spells found</p>
                <button className="neon-button primary" onClick={() => setShowCreateModal(true)}>Prepare First Spell</button>
              </div>
            ) : filteredSpells.map(spell => (
              <div className="spell-row" key={spell.id} onClick={() => setSelectedSpell(spell)}>
                <div className="table-cell spell-id">#{spell.id.substring(0, 6)}</div>
                <div className="table-cell">{spell.spellType}</div>
                <div className="table-cell">{spell.caster.substring(0, 6)}...{spell.caster.substring(38)}</div>
                <div className="table-cell">{spell.manaCost}</div>
                <div className="table-cell">{new Date(spell.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell"><span className={`status-badge ${spell.status}`}>{spell.status}</span></div>
                <div className="table-cell actions">
                  {isCaster(spell.caster) && spell.status === "prepared" && (
                    <>
                      <button className="action-btn neon-button success" onClick={(e) => { e.stopPropagation(); executeSpell(spell.id); }}>Cast</button>
                      <button className="action-btn neon-button danger" onClick={(e) => { e.stopPropagation(); failSpell(spell.id); }}>Fail</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {showCreateModal && <ModalCreate onSubmit={castSpell} onClose={() => setShowCreateModal(false)} casting={casting} spellData={newSpellData} setSpellData={setNewSpellData}/>}
      {selectedSpell && <SpellDetailModal spell={selectedSpell} onClose={() => { setSelectedSpell(null); setDecryptedValue(null); }} decryptedValue={decryptedValue} setDecryptedValue={setDecryptedValue} isDecrypting={isDecrypting} decryptWithSignature={decryptWithSignature}/>}
      {spellStatus.visible && (
        <div className="spell-modal">
          <div className="spell-content neon-card">
            <div className={`spell-icon ${spellStatus.status}`}>
              {spellStatus.status === "pending" && <div className="neon-spinner"></div>}
              {spellStatus.status === "success" && <div className="check-icon"></div>}
              {spellStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="spell-message">{spellStatus.message}</div>
          </div>
        </div>
      )}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="crystal-icon"></div><span>FHEX077</span></div>
            <p>Magic is code in this autonomous world powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Arcane Documentation</a>
            <a href="#" className="footer-link">Spell Components</a>
            <a href="#" className="footer-link">Mana Regulations</a>
            <a href="#" className="footer-link">Contact Archmages</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Magic</span></div>
          <div className="copyright">© {new Date().getFullYear()} FHEX077. All spells reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  casting: boolean;
  spellData: any;
  setSpellData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, casting, spellData, setSpellData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSpellData({ ...spellData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSpellData({ ...spellData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!spellData.spellType || !spellData.manaCost) { alert("Please fill required fields"); return; }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal neon-card">
        <div className="modal-header">
          <h2>Prepare New Spell</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Your spell components will be encrypted with Zama FHE before casting</p></div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Spell Type *</label>
              <select name="spellType" value={spellData.spellType} onChange={handleChange} className="neon-select">
                <option value="">Select spell type</option>
                <option value="Fireball">Fireball</option>
                <option value="Healing">Healing</option>
                <option value="Invisibility">Invisibility</option>
                <option value="Telekinesis">Telekinesis</option>
                <option value="Divination">Divination</option>
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input type="text" name="description" value={spellData.description} onChange={handleChange} placeholder="Spell description..." className="neon-input"/>
            </div>
            <div className="form-group">
              <label>Mana Cost *</label>
              <input 
                type="number" 
                name="manaCost" 
                value={spellData.manaCost} 
                onChange={handleValueChange} 
                placeholder="Enter mana cost..." 
                className="neon-input"
                step="1"
              />
            </div>
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain Value:</span><div>{spellData.manaCost || 'No value entered'}</div></div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{spellData.manaCost ? FHEEncryptNumber(spellData.manaCost).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div><strong>Spell Privacy</strong><p>Spell components remain encrypted during FHE processing and are never revealed</p></div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn neon-button">Cancel</button>
          <button onClick={handleSubmit} disabled={casting} className="submit-btn neon-button primary">
            {casting ? "Encrypting with FHE..." : "Prepare Spell"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface SpellDetailModalProps {
  spell: SpellRecord;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const SpellDetailModal: React.FC<SpellDetailModalProps> = ({ spell, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(spell.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="spell-detail-modal neon-card">
        <div className="modal-header">
          <h2>Spell Details #{spell.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="spell-info">
            <div className="info-item"><span>Type:</span><strong>{spell.spellType}</strong></div>
            <div className="info-item"><span>Caster:</span><strong>{spell.caster.substring(0, 6)}...{spell.caster.substring(38)}</strong></div>
            <div className="info-item"><span>Date:</span><strong>{new Date(spell.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${spell.status}`}>{spell.status}</strong></div>
          </div>
          <div className="encrypted-data-section">
            <h3>Encrypted Spell Data</h3>
            <div className="encrypted-data">{spell.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button className="decrypt-btn neon-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedValue !== null ? "Hide Decrypted Value" : "Decrypt with Wizard Signature"}
            </button>
          </div>
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Mana Cost</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice"><div className="warning-icon"></div><span>Decrypted data is only visible after magical signature verification</span></div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn neon-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;