// data.ts — domain models + sample blueprint library

export type SourceId = 'scim' | 'sbp' | 'local' | 'url';
export type StatusId = 'installed' | 'update' | 'config' | 'none';

export interface Source { id: SourceId; label: string; short: string; color: string; host: string }
export interface Status { id: StatusId; label: string; color: string; ghost: string }

export interface Blueprint {
  id: string;
  name: string;
  source: SourceId;
  category: string;
  tags: string[];
  modded: boolean;
  materials: string[];
  shots: number;
  files: { sbp: boolean; sbpcfg: boolean };
  status: StatusId;
  /** thumbnail art is a seeded isometric placeholder; hue + seed drive it */
  hue: number;
  seed: number;
  sizeKB: number;
  /** YYYY-MM-DD */
  added: string;
  notes: string;
  url: string;
  /** world session folder it lives in (blueprints read from disk) */
  session?: string;
  /** true when this entry is a real .sbp file in the game folder */
  onDisk?: boolean;
  /** content fingerprint; the saved picture is fetched with it */
  imageKey?: string;
  /** a picture URL to use directly (browser preview) */
  imageUrl?: string;
  /** title from the blueprint's web page, when it differs from the file name */
  title?: string;
  // Metadata from blueprint sites. Files on disk don't carry it, so it can be missing.
  author?: string;
  gameVersion?: string;
  dims?: { x: number; y: number; z: number };
  power?: { use: number; gen: number };
  machines?: number;
  downloads?: number;
}

export const SOURCES: Record<SourceId, Source> = {
  scim:  { id:'scim',  label:'SCIM',                    short:'SCIM',  color:'#5b9bd5', host:'satisfactory-calculator.com' },
  sbp:   { id:'sbp',   label:'Satisfactory Blueprints', short:'SBP',   color:'#b07cf0', host:'satisfactoryblueprints.com' },
  local: { id:'local', label:'Local Import',            short:'LOCAL', color:'#5ccb8e', host:'this machine' },
  url:   { id:'url',   label:'Direct URL',              short:'URL',   color:'#ffae3b', host:'direct download' },
};

export const STATUS: Record<StatusId, Status> = {
  installed: { id:'installed', label:'Installed',        color:'var(--ok)',   ghost:'var(--ok-ghost)' },
  update:    { id:'update',    label:'Update available', color:'var(--info)', ghost:'var(--info-ghost)' },
  config:    { id:'config',    label:'Missing config',   color:'var(--warn)', ghost:'var(--warn-ghost)' },
  none:      { id:'none',      label:'Not installed',    color:'var(--off)',  ghost:'var(--off-ghost)' },
};

export const ALL_TAGS = ['Architecture','Power','Logistics','Production','Trains','Starter','Modular','World Grid','Vanilla','Modded'];
export const CATEGORIES = ['Manufacturing','Power','Logistics','Architecture','Transport'];
export const GAME_VERSIONS = ['1.0','0.8','Any'];

export type NavId = 'library' | 'import' | 'recent' | 'favorites';

export const SAMPLE_LIBRARY: Blueprint[] = [
  {
    id:'bp-001', name:'Modular Manufacturer L', author:'KapitanWalnut', source:'scim',
    category:'Manufacturing', tags:['Production','Modular','World Grid','Vanilla'],
    gameVersion:'1.0', modded:false, dims:{x:32,y:24,z:18}, power:{use:480, gen:0},
    machines:42, materials:['Heavy Modular Frame','Computer','Motor'], shots:5,
    files:{sbp:true,sbpcfg:true}, status:'installed', hue:38, seed:7, sizeKB:214, downloads:18420,
    added:'2026-05-21', notes:'Tileable manufacturer block snapped to the world grid. Inputs on south face, packaged output on north belt lane.',
    url:'https://satisfactory-calculator.com/en/blueprints/index/details/id/12162/name/Modular+Manufacturer+L',
  },
  {
    id:'bp-002', name:'Compact Coal Power Starter', author:'gridlocked', source:'sbp',
    category:'Power', tags:['Power','Starter','Vanilla'],
    gameVersion:'1.0', modded:false, dims:{x:18,y:16,z:12}, power:{use:0, gen:900},
    machines:12, materials:['Coal','Water'], shots:4,
    files:{sbp:true,sbpcfg:false}, status:'config', hue:34, seed:3, sizeKB:88, downloads:9310,
    added:'2026-05-19', notes:'8 coal generators + balanced water manifold. Drop near a coal node and a lake. Fits a 2x2 foundation footprint.',
    url:'https://satisfactoryblueprints.com/blueprint/c4ae7a98-699a-4aab-af31-61f99cfd71f0',
  },
  {
    id:'bp-003', name:'30x Packager Cube 1800/min', author:'BeltGremlin', source:'scim',
    category:'Manufacturing', tags:['Production','Logistics','Modular'],
    gameVersion:'1.0', modded:false, dims:{x:20,y:20,z:28}, power:{use:300, gen:0},
    machines:30, materials:['Packaged Fuel','Empty Canister'], shots:6,
    files:{sbp:true,sbpcfg:true}, status:'update', hue:42, seed:11, sizeKB:176, downloads:24110,
    added:'2026-05-17', notes:'Vertical packager stack, 30 units, 1800 packaged/min throughput. Lift-fed, mk5 belts.',
    url:'https://satisfactory-calculator.com/en/blueprints/index/details/id/13881/name/30x+Packager+Cube',
  },
  {
    id:'bp-004', name:'Dark Futuristic Train Station', author:'NocturneFICSIT', source:'sbp',
    category:'Transport', tags:['Trains','Architecture','Logistics','Modded'],
    gameVersion:'1.0', modded:true, dims:{x:48,y:16,z:22}, power:{use:120, gen:0},
    machines:6, materials:['Steel Beam','Glass'], shots:8,
    files:{sbp:true,sbpcfg:true}, status:'installed', hue:30, seed:19, sizeKB:402, downloads:31200,
    added:'2026-05-14', notes:'Two-platform freight terminal with covered concourse. Uses Ficsit Architecture mod parts for trim.',
    url:'https://satisfactoryblueprints.com/blueprint/8b21de4f-22aa-4a01-9c11-77d2ea1188bc',
  },
  {
    id:'bp-005', name:'Heavy Modular Frame Microfactory', author:'KapitanWalnut', source:'local',
    category:'Manufacturing', tags:['Production','Modular','Starter'],
    gameVersion:'1.0', modded:false, dims:{x:24,y:18,z:14}, power:{use:260, gen:0},
    machines:24, materials:['Heavy Modular Frame','Modular Frame','Steel Pipe'], shots:3,
    files:{sbp:true,sbpcfg:true}, status:'none', hue:40, seed:5, sizeKB:142, downloads:0,
    added:'2026-05-12', notes:'Self-contained HMF line from iron + coal. Good Phase 3 milestone helper.',
    url:'',
  },
  {
    id:'bp-006', name:'World Grid Aligned Smelter Block', author:'gridlocked', source:'scim',
    category:'Manufacturing', tags:['Production','World Grid','Vanilla','Starter'],
    gameVersion:'1.0', modded:false, dims:{x:16,y:32,z:10}, power:{use:200, gen:0},
    machines:24, materials:['Iron Ingot','Copper Ingot'], shots:4,
    files:{sbp:true,sbpcfg:true}, status:'installed', hue:36, seed:13, sizeKB:120, downloads:15600,
    added:'2026-05-10', notes:'Mixed smelter bank perfectly aligned to the 8m world grid. Belt lanes exit on grid lines.',
    url:'https://satisfactory-calculator.com/en/blueprints/index/details/id/14002/name/Smelter+Block',
  },
  {
    id:'bp-007', name:'Hypertube Cannon Mk.II', author:'VelocityRaptor', source:'url',
    category:'Transport', tags:['Logistics','Trains','Modded'],
    gameVersion:'1.0', modded:true, dims:{x:12,y:12,z:40}, power:{use:80, gen:0},
    machines:18, materials:['Hypertube','Pipeline Junction'], shots:5,
    files:{sbp:true,sbpcfg:false}, status:'config', hue:28, seed:23, sizeKB:96, downloads:5400,
    added:'2026-05-08', notes:'Launch stack with entrance buffer. Tune booster count to map height. Bring a parachute.',
    url:'https://files.example.com/blueprints/hypertube-cannon-mk2.sbp',
  },
  {
    id:'bp-008', name:'Aluminum Scrap Refinery Wing', author:'OxideWorks', source:'sbp',
    category:'Manufacturing', tags:['Production','Modular','Vanilla'],
    gameVersion:'1.0', modded:false, dims:{x:36,y:28,z:16}, power:{use:640, gen:0},
    machines:48, materials:['Alumina Solution','Aluminum Scrap','Water'], shots:6,
    files:{sbp:true,sbpcfg:true}, status:'update', hue:44, seed:17, sizeKB:288, downloads:12700,
    added:'2026-05-05', notes:'Full alumina → aluminum ingot wing with water recycling loop. Watch the byproduct silica.',
    url:'https://satisfactoryblueprints.com/blueprint/f3d9c712-44bb-4c88-a210-9911aa3def01',
  },
  {
    id:'bp-009', name:'Vertical Storage Hub 48-Stack', author:'BeltGremlin', source:'scim',
    category:'Logistics', tags:['Logistics','Architecture','Modular','World Grid'],
    gameVersion:'1.0', modded:false, dims:{x:20,y:20,z:34}, power:{use:60, gen:0},
    machines:8, materials:['Industrial Storage','Steel Beam'], shots:5,
    files:{sbp:true,sbpcfg:true}, status:'installed', hue:32, seed:29, sizeKB:198, downloads:21800,
    added:'2026-05-03', notes:'48 industrial containers on a central lift spine. Load/unload faces split front/back.',
    url:'https://satisfactory-calculator.com/en/blueprints/index/details/id/14550/name/Storage+Hub',
  },
  {
    id:'bp-010', name:'Nuclear Pasta Assembly Spire', author:'SingularityCo', source:'sbp',
    category:'Manufacturing', tags:['Production','Architecture','Modded'],
    gameVersion:'1.0', modded:true, dims:{x:30,y:30,z:60}, power:{use:1200, gen:0},
    machines:36, materials:['Copper Powder','Pressure Conversion Cube'], shots:7,
    files:{sbp:true,sbpcfg:true}, status:'none', hue:26, seed:31, sizeKB:512, downloads:8900,
    added:'2026-04-29', notes:'Endgame nuclear pasta tower. Heavy power draw — pair with a dedicated grid.',
    url:'https://satisfactoryblueprints.com/blueprint/a1029bef-7711-49cc-b0a2-5521ee99fa12',
  },
  {
    id:'bp-011', name:'Fuel Generator Array 2.5GW', author:'gridlocked', source:'url',
    category:'Power', tags:['Power','Modular','Vanilla'],
    gameVersion:'1.0', modded:false, dims:{x:40,y:20,z:14}, power:{use:0, gen:2500},
    machines:25, materials:['Fuel','Crude Oil'], shots:4,
    files:{sbp:true,sbpcfg:true}, status:'installed', hue:38, seed:37, sizeKB:230, downloads:0,
    added:'2026-04-27', notes:'25 fuel generators on a shared pipe manifold. Modular, snap two together for 5GW.',
    url:'https://files.example.com/blueprints/fuel-array-25gw.sbp',
  },
  {
    id:'bp-012', name:'Rail Switchyard Junction', author:'NocturneFICSIT', source:'local',
    category:'Transport', tags:['Trains','Logistics','World Grid'],
    gameVersion:'1.0', modded:false, dims:{x:64,y:48,z:8}, power:{use:0, gen:0},
    machines:0, materials:['Railway','Train Signal'], shots:6,
    files:{sbp:true,sbpcfg:false}, status:'config', hue:34, seed:41, sizeKB:340, downloads:0,
    added:'2026-04-24', notes:'Four-way grade-separated rail junction with block + path signals pre-placed. Grid aligned.',
    url:'',
  },
];

/** "32×24×18", or null when the size is unknown (files on disk) */
export const dimsLabel = (b: Blueprint) => b.dims ? `${b.dims.x}×${b.dims.y}×${b.dims.z}` : null;
/** combined power figure used for sorting */
export const powerTotal = (b: Blueprint) => b.power ? b.power.use + b.power.gen : 0;
