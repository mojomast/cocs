'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,AudioLines,Check,ChevronDown,Crosshair,Film,Hexagon,LockKeyhole,Maximize,Minimize,Mic,Pause,Play,RotateCcw,Settings,Shield,SkipForward,Sparkles,Terminal,Trash2,Trophy,Users,Volume2,VolumeX,X,Zap} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {MAPS,getMap} from '../game/maps.mjs';
import {mapsForMode,resolveMapForMode} from '../game/arenas.mjs';
import {WEATHER_KINDS} from '../game/environment.mjs';
import {Switch} from '@/components/ui/switch';
import {CHARACTERS,HARNESSES,WEAPONS,RULES,resolveLoadout} from '../game/data.mjs';
import {Match,effectiveSpread} from '../game/core.mjs';
import {NetClient,DEFAULT_SERVER_URL} from '../game/net.mjs';
import {VoiceChat} from '../game/voice.mjs';
import {DEFAULT_CONFIG,DEFAULT_DISPLAY,DIFFICULTIES,normalizeConfig,normalizeDisplay,GAME_MODES,isCocsMode} from '../game/config.mjs';
import {HELP_SECTIONS,ONBOARDING_STEPS,persistOnboardingState,readOnboardingState,shouldShowOnboarding} from '../game/onboarding.mjs';
import {ACCESSIBILITY_STORAGE_KEY,PRESET_STORAGE_KEY,addPreset,defaultAccessibility,enginePaletteFor,normalizeAccessibility,normalizePreset,normalizePresets,radarPaletteFor,removePreset} from '../game/presets.mjs';
import {DEFAULT_BINDINGS,KEYBIND_STORAGE_KEY,actionForCode,bindingConflicts,bindingLabel,bindingShortcut,normalizeBindings} from '../game/keybinds.mjs';
import {CURSOR_SURFACE,cursorActive,cursorBlockingSurfaces,cursorClear,cursorClose,cursorCombatKeysBlocked,cursorEscape,cursorHint,cursorKeyboardOwner,cursorLockGained,cursorLockLost,cursorOpen,cursorReset,cursorSurfaceText,cursorToggle,initialCursorMode} from '../game/cursor-mode.mjs';
import {LOCAL_CARD_ACTION,LOCAL_CARD_SOURCE,latticePeerId,localBoardCards,mergeLocalBoard,withSinkTargets} from '../game/lattice-board.mjs';
import {coopOrderGate,coopSpendGate} from '../game/cocs-coop.mjs';
import {reqPurchaseOptions} from '../game/cocs-economy.mjs';
import {depotPurchaseState} from '../game/cocs-traversal.mjs';
import {MatchConfiguration,DisplayConfiguration,PresetsConfiguration,KeybindsConfiguration,AccessibilityConfiguration} from './game-ui/configuration';
import {GameChat} from './game-ui/game-chat';
import {RaceHud} from './game-ui/race-hud';
import {SoccerHud} from './game-ui/soccer-hud';
import {SinglePlayerHud} from './game-ui/singleplayer-hud';
import type {UiBag} from './ui/contract';
import {TitleScreen} from './ui/screens/TitleScreen';
import {SelectionScreen} from './ui/screens/SelectionScreen';
import {ProgressionScreen} from './ui/screens/ProgressionScreen';
import {BrowseScreen,LobbyScreen} from './ui/screens/NetScreens';
import {SetupModal,SinglePlayerModal,OnboardingModal} from './ui/screens/SetupModals';
import {PauseModal,ResultsModal} from './ui/screens/ResultModals';
import {TheaterScreen} from './ui/screens/TheaterScreen';
import {PlayingHud} from './ui/screens/PlayingHud';
import {reconcileReqBuys,reqReasonCopy} from './ui/screens/CommandBoardHud';
import {RespawnOverlay} from './ui/screens/RespawnOverlay';
import {SettingsDialog} from './ui/screens/SettingsDialog';
import {respawnOverlayView} from '../game/respawn-ui.mjs';
import {shuffleSelection,nextArenaSelection,surpriseSelection} from '../game/replay.mjs';
import {CinematicDirector,CAMERA_RIGS} from '../game/director.mjs';
import {CAMERA_MODES,CAMERA_MODE_LABELS,cycleCameraMode,cameraModeRig} from '../game/camera-modes.mjs';
import {DemoRecorder,DemoPlayer} from '../game/demo.mjs';
import {saveDemo,listDemos,getDemo,deleteDemo,demoSummary,exportDemo,importDemoToStore} from '../game/demo-store.mjs';
import {blocksGameplay,controlsFromState,cycleWeapon,hasAmmo,isEditable} from '../game/input.mjs';
import {applyLook,isTouchDevice} from '../game/touch.mjs';
import {TouchControls} from './game-ui/touch-controls';
import {ACHIEVEMENTS,PRESTIGE_TIERS,PRESTIGE_XP,achievementStatus,awardMatch,defaultProgression,GEAR,GEAR_SLOTS,levelFromXp,matchRewardSummary,matchSummaryCard,normalizeGear,normalizeProgression,prestigeFromXp,prestigeTier,prestigeXpBonus,rankBlurb,rankTitle,UNLOCKS,unlockedItems} from '../game/progression.mjs';
import {CHALLENGE_STORAGE_KEY,applyMatchAll,challengeStatus,currentDaySeed,normalizeChallengeState,weeklyStatus} from '../game/challenges.mjs';
import {emptyHistory,historyEntryFromResult,historyLeaderboard,historyTotals,loadHistory,recordMatch,saveHistory} from '../game/history.mjs';
import {ATTACHMENTS,ATTACHMENT_SLOTS,normalizeAttachments} from '../game/attachments.mjs';
import {WEAPON_FINISHES,CROSSHAIR_STYLES,FINISH_IDS,CROSSHAIR_IDS} from '../game/cosmetics.mjs';
import {harnessVehicle,harnessWeaponHandling} from '../game/harness-profiles.mjs';
import {pickShowcase,seatShowcaseVehicles,SHOWCASE_MAX_SECONDS} from '../game/showcase.mjs';
import {buildShowcase as buildShowcaseFactory} from '../game/showcase-build.mjs';
import {demoBroadcast} from '../game/broadcast.mjs';
import {roomFromLocation,spectateFromLocation} from '../game/invite.mjs';
import {CHANGELOG,RELEASE_VERSION,RELEASE_CODENAME,FULL_CHANGELOG_URL} from '../game/changelog.mjs';
import {useGraphicsLab} from './ui/useGraphicsLab';
import {GRAPHICS_LAB_HOTKEY,describeGraphicsLab} from '../game/graphics-lab.mjs';
import {DemoBroadcast} from './ui/DemoBroadcast';
import {DemoControls} from './ui/DemoControls';
import {DemoOptions} from './ui/DemoOptions';
import {applyDemoEvent,applyDemoOptions,createDemoSession,demoOptionsDirty,demoPinned,demoRunningLabels,demoScenarioState,freeCamStep,loadDemoSettings,nextDemoSubject,DEMO_SETTINGS_KEY,pickDemoScenario,storeDemoSettings} from '../game/demo-session.mjs';
import {ChangelogScreen} from './ui/screens/ChangelogScreen';
import {buildSpectateMatch} from '../game/spectate-build.mjs';
import {renderScoreboard} from '../game/scoreboard.mjs';
import {radarContacts,radarBlip} from '../game/radar.mjs';
import {resetNetworkPresentation,selectRenderState} from '../game/presentation.mjs';
import {actorWon} from '../game/outcome.mjs';
import {raceDisplay,raceResult,raceTime,soccerDisplay,soccerResult} from '../game/race-ui.mjs';
import {campaignMissionView,campaignProgressSummary,singlePlayerDisplay,singlePlayerResult,singlePlayerSummary} from '../game/singleplayer-ui.mjs';
import {resumeSinglePlayer,selectHordeUpgrade as applyHordeUpgrade} from '../game/singleplayer.mjs';
import {CAMPAIGN_MISSIONS,missionFor} from '../game/campaign-data.mjs';
import {CAMPAIGN_STORAGE_KEY,campaignLaunchCheckpoint,clearCheckpoint,defaultCampaignProgress,isMissionComplete,isMissionUnlocked,normalizeCampaignProgress,nextMissionId,recordMission,setCheckpoint} from '../game/campaign-progress.mjs';
import {reducedMotion as combineReducedMotion} from '../game/post.mjs';
import {terrainSupportAt} from '../game/terrain.mjs';
import {PerfTracker,BENCHMARK_PRESET,benchmarkReport,benchmarkDisplay} from '../game/perf.mjs';
import {ammoText,boundList,cocsResultSummary,cocsBoard,commandBrief,damageBearing,damageNumberStyle,dynamicCrosshairGap,escapeHint,flagText,hitMarker,isTeamMode,killBanner,killCallout,connectionQuality,modeGoal,modePrimary,nextSpectateTarget,spectatorBoard,spectatorTeams,killFeedWeapon,lowAmmo,matchAwards,matchStartBanner,scoreText,suddenDeathBanner,grenadeStatus,killstreakCallout,ladderStatus,streakStatus,audioCaption,cocsAnnouncement,acceptCocsAnnouncement,postureLabel,projectToScreen,reloadProgress,scoreAnnouncer,teamName,teamScoreText,vehicleHud,voiceHint,weaponRangeLabel,weaponTag} from '../game/hud.mjs';
import {cocsArmVerb,cocsClearStrip,cocsCommandView,cocsIssueOrder,cocsPickTarget,cocsStripState,cocsTargetableNodes} from '../game/cocs-orders.mjs';
import {cocsBoard as latticeBoardView} from '../game/hud.mjs';
import {filterCocsEvents} from '../game/cocs-intel.mjs';
import {latticeCoach,latticeKeys,latticeNodeLabel,latticeOrderKey,latticePracticeDefaults,latticeTargetModel} from '../game/lattice-guide.mjs';
import {createTraining,evaluateTraining,trainingView,continueTraining,skipTraining,trainingConfig,applyTrainingGuard} from '../game/lattice-training.mjs';
import {accessibilityFlagsFrom,appendStudyEvent,createStudyLog,deleteStudyLog,serializeStudyLog,setStudyConsent,setStudyLogBuild,studyLogSummary,viewportBucketFor} from '../game/study-log.mjs';
import {configureMothAssets,mothIr,mothMotif} from '../game/moth-assets.mjs';
import {MothAudioBank,MothAudio} from '../game/moth-audio.mjs';

// Activate the assets baked from Moth Quantum engines. Inert — every accessor
// returns null and the procedural generators stay in charge — until a bake has
// been run, so this is safe to call unconditionally.
configureMothAssets();

type Mode='selection'|'browse'|'lobby'|'theater'|'playing'|'paused'|'results'|'progression'|'changelog';
const defaultNetUrl=typeof window!=='undefined'&&!['localhost','127.0.0.1'].includes(window.location.hostname)?`${window.location.protocol==='https:'?'wss':'ws'}://${window.location.host}/ws`:DEFAULT_SERVER_URL;
const powerIcon=(id:string,size=22)=>id==='openclaw'?<Sparkles size={size}/>:id==='hermes'?<Zap size={size}/>:id==='opencode'?<Terminal size={size}/>:id==='codex'?<RotateCcw size={size}/>:id==='cline'?<SkipForward size={size}/>:id==='roo'?<AudioLines size={size}/>:<Shield size={size}/>;
const GitHubMark=({size=18}:{size?:number})=><svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>;
const clock=(t:number)=>`${Math.floor(Math.max(0,t)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,t)%60).toString().padStart(2,'0')}`;
let reducedOverride=false;
const reducedMotion=()=>combineReducedMotion(reducedOverride,typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true);
// B on the command board: a press shorter than this opens and stays open
// (toggle); a longer hold closes on release (peek). Escape and the close button
// always close it.
const BOARD_HOLD_MS=250;
const BRAND={name:'Colosseum Of Competitive Slop',abbr:'COCS',tagline:'Nine language models. Seven harnesses. One glorious colosseum of slop.'};
const ACRONYM=[{letter:'C',word:'COLOSSEUM'},{letter:'O',word:'OF'},{letter:'C',word:'COMPETITIVE'},{letter:'S',word:'SLOP'}];
const UNLOCK_GROUPS=[{kind:'gear',label:'GEAR'},{kind:'attachment',label:'WEAPON MODS'},{kind:'finish',label:'WEAPON FINISHES'},{kind:'crosshair',label:'RETICLES'}];
// WP3.2: the first participant-initiated objective action of a match is a
// journey transition worth its own beat; one flag per match bounds the count.
const FIRST_STUDY_ACTIONS=new Set(['order_queued','order_accepted','spend_attempted','training_step_completed']);
const Wordmark=({sub}:{sub:string})=><div className="wordmark"><Crosshair size={25}/><span>COCS<em className="wordmark-full">Colosseum Of Competitive Slop</em></span><small>{sub}</small></div>;
// SVG attributes are stringified by different code paths during SSR and DOM
// hydration. Quantizing generated map geometry prevents harmless last-bit float
// differences from becoming React hydration warnings.
const svgNumber=(value:unknown)=>Math.round(Number(value)*1e6)/1e6;
const MapPlan=({map,viewBox}:{map:any;viewBox:string})=><svg className="map-plan" viewBox={viewBox} aria-hidden="true"><rect x={svgNumber(map.bounds?.minX??-15)} y={svgNumber(map.bounds?.minZ??-15)} width={svgNumber(map.bounds?map.bounds.maxX-map.bounds.minX:30)} height={svgNumber(map.bounds?map.bounds.maxZ-map.bounds.minZ:30)} fill="#0a1218"/>{(map.platforms||[]).map((p:any,i:number)=><rect key={`platform-${i}`} x={svgNumber(p.x-p.w/2)} y={svgNumber(p.z-p.d/2)} width={svgNumber(p.w)} height={svgNumber(p.d)} fill={p.route==='north'?'#d5a45c':p.route==='south'?'#b28cff':map.color} opacity=".35"/>)}{(map.jumpLinks||[]).map((link:any,i:number)=><line key={`link-${i}`} x1={svgNumber(link.source.x)} y1={svgNumber(link.source.z)} x2={svgNumber(link.target.x)} y2={svgNumber(link.target.z)} stroke={map.color} strokeWidth=".35" opacity=".8"/>)}{map.blocks.map((b:any,i:number)=><rect key={`block-${i}`} x={svgNumber(b.x-b.w/2)} y={svgNumber(b.z-b.d/2)} width={svgNumber(b.w)} height={svgNumber(b.d)} fill={b.kind==='wall'?'#4c6469':map.color} opacity={b.kind==='deck'?.25:.8}/> )}</svg>;
const matchPhase=(hud:any)=>{const ratio=hud?.config?.timeLimit?hud.time/hud.config.timeLimit:0;return ratio<.2?'OPENING':ratio<.72?'CONTESTED':'CLOSING';};
export const routeContext=(map:any,player:any)=>{const platforms=map?.platforms??[];if(platforms.length&&player){const nearest=platforms.reduce((best:any,p:any)=>{const distance=Math.hypot((player.x??0)-p.x,(player.z??0)-p.z);return !best||distance<best.distance?{distance,route:p.route}:best},null);if(nearest?.route)return `${nearest.route.toUpperCase()} ROUTE`;}const tag=String(map?.tag??'').toUpperCase();return tag.includes('CANYON')?'CANYON':tag.includes('OUTDOOR')?'OUTDOOR':'ARENA';};
const resultTitle=(hud:any,player:any)=>{const mode=GAME_MODES.find((m:any)=>m.id===hud?.config?.mode);if(isTeamMode(mode)){if(hud?.winner!==null&&hud?.winner!==undefined)return `${teamName(hud.winner)} TEAM WINS.`;const scores=hud?.teamScores||{},max=Math.max(...Object.values(scores).map(Number)),leaders=[0,1].filter(team=>Number(scores[team]??0)===max);return leaders.length>1?'DEAD HEAT.':`${teamName(leaders[0])} LEADS.`;}if(hud?.config?.botCount===0)return 'PRACTICE COMPLETE.';return hud?.leaders?.length>1?'DEAD HEAT.':player?.frags===Math.max(...(hud?.actors||[]).map((a:any)=>a.frags))?'YOU OWN THE ARENA.':`${hud?.leaders?.[0]||'ARENA'} WINS.`;};
const resultDescription=(hud:any,player:any)=>{const mode=GAME_MODES.find((m:any)=>m.id===hud?.config?.mode);if(isCocsMode(mode)){const summary=cocsResultSummary(hud,player);if(summary)return summary;}if(isTeamMode(mode)){const scores=hud?.teamScores||{},lead=Math.max(Number(scores[0]??0),Number(scores[1]??0));if(hud?.winner!==null&&hud?.winner!==undefined)return `${teamName(hud.winner)} finished on ${scoreText(scores[hud.winner])} ${modeGoal(mode).toLowerCase()}.`;return `The round ended ${teamName(0)} ${scoreText(scores[0])} · ${teamName(1)} ${scoreText(scores[1])}; ${scoreText(lead)} is the current high score.`;}return hud?.config?.botCount===0?'Ready to add opponents? Return to loadout to change your match.':hud?.leaders?.length>1?`${hud.leaders.join(' & ')} tied for the lead.`:'The last token has been spent.';};
export default function Home(){
  const canvas=useRef<HTMLCanvasElement>(null),runtime=useRef<any>(null),modeRef=useRef<Mode>('selection');
  const [mode,setMode]=useState<Mode>('selection'),[entered,setEntered]=useState(false),[character,setCharacter]=useState('chatgpt'),[harness,setHarness]=useState('openclaw'),[mapId,setMapId]=useState('colosseum'),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[hud,setHud]=useState<any>(null),[scores,setScores]=useState(false),[sensitivity,setSensitivity]=useState(1),[muted,setMuted]=useState(false),[settings,setSettings]=useState(false),[touchControls,setTouchControls]=useState(false),[fullscreen,setFullscreen]=useState(false),[pointerHint,setPointerHint]=useState(false),[netUrl,setNetUrl]=useState(defaultNetUrl),[netPlayers,setNetPlayers]=useState<any[]>([]),[netError,setNetError]=useState('');
  const [musicVolume,setMusicVolume]=useState(.7),[effectsVolume,setEffectsVolume]=useState(1),[ambienceVolume,setAmbienceVolume]=useState(.8),[audioNotice,setAudioNotice]=useState('');
  const [config,setConfig]=useState<any>({...DEFAULT_CONFIG}),[display,setDisplay]=useState<any>({...DEFAULT_DISPLAY}),[accessibility,setAccessibility]=useState<any>(()=>defaultAccessibility()),[rooms,setRooms]=useState<any[]>([]),[matches,setMatches]=useState<any[]>([]),[roomName,setRoomName]=useState(''),[netRoomId,setNetRoomId]=useState('');
  const [chatOpen,setChatOpen]=useState(false),[chatDraft,setChatDraft]=useState(''),[chatLog,setChatLog]=useState<any[]>([]),[setupOpen,setSetupOpen]=useState(false),[legacyMaps,setLegacyMaps]=useState(false);
  const [singleOpen,setSingleOpen]=useState(false),[singleSub,setSingleSub]=useState<'horde'|'campaign'>('horde'),[singleMission,setSingleMission]=useState<string>(CAMPAIGN_MISSIONS[0].id);
  const [campaign,setCampaign]=useState<any>(defaultCampaignProgress);
  const [showcase,setShowcase]=useState(true),[showcaseLive,setShowcaseLive]=useState(false),[profile,setProfile]=useState<any>(defaultProgression()),[unlockQueue,setUnlockQueue]=useState<any[]>([]),[achievementQueue,setAchievementQueue]=useState<any[]>([]),[reward,setReward]=useState<any>(null),[demos,setDemos]=useState<any[]>([]),[demoNotice,setDemoNotice]=useState(''),[demoPlaying,setDemoPlaying]=useState(false),[demoPaused,setDemoPaused]=useState(false),[demoTime,setDemoTime]=useState(0),[demoSpeed,setDemoSpeed]=useState(1),[demoRig,setDemoRig]=useState('orbit'),[demoInfo,setDemoInfo]=useState<any>(null),[lastDemo,setLastDemo]=useState<any>(null);
  const [onboarding,setOnboarding]=useState<number|null>(null);
  const [broadcast,setBroadcast]=useState<any>(null);
  const [updateReady,setUpdateReady]=useState(false);
  const [demoOnly,setDemoOnly]=useState(false);
  const [demoSession,setDemoSession]=useState<any>(()=>createDemoSession());
  const [demoMusic,setDemoMusic]=useState(true);
  const [demoAmbience,setDemoAmbience]=useState(true);
  const [demoAnnouncer,setDemoAnnouncer]=useState(true);
  const [demoWeather,setDemoWeather]=useState<string|null>(null);
  const [challengeState,setChallengeState]=useState<any>(()=>normalizeChallengeState({}));
  const [history,setHistory]=useState<any>(()=>emptyHistory());
  const [settingsTab,setSettingsTab]=useState('game');
  const graphicsLab=useGraphicsLab(runtime,ready);
  // Hotkey access: the once-registered key handlers read the live lab state from
  // this ref, and a transient banner confirms every toggle made in-world.
  const graphicsLabRef=useRef<ReturnType<typeof useGraphicsLab>|null>(null),graphicsNoticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [graphicsNotice,setGraphicsNotice]=useState('');
  useEffect(()=>{graphicsLabRef.current=graphicsLab;},[graphicsLab]);
  useEffect(()=>()=>{if(graphicsNoticeTimer.current)clearTimeout(graphicsNoticeTimer.current);},[]);
  const showGraphicsNotice=(text:string)=>{setGraphicsNotice(text);if(graphicsNoticeTimer.current)clearTimeout(graphicsNoticeTimer.current);graphicsNoticeTimer.current=setTimeout(()=>setGraphicsNotice(''),1900);};
  const [presets,setPresets]=useState<any[]>([]);
  const [netInfo,setNetInfo]=useState<any>({connected:false,peerId:null,hostId:null,isHost:false,started:false,spectate:false,actorId:null,roundOver:false,roomId:null});
  // Ranked V2 online state: the server's ladder projection from the last lobby
  // message plus the local optimistic queue flag. The rating itself is never
  // computed or cached for authority on the client.
  const [netRanked,setNetRanked]=useState<any>(null);
  const [netQueued,setNetQueued]=useState<any>(null);
  const [hideHud,setHideHud]=useState(false),[thirdPerson,setThirdPerson]=useState(false),[bindings,setBindings]=useState<any>({...DEFAULT_BINDINGS});
  const [cocsStrip,setCocsStrip]=useState<any>(()=>cocsStripState());
  const [cocsBoard,setCocsBoard]=useState<any>({open:false,pinned:false,active:0});
  const [cocsNotice,setCocsNotice]=useState<any>(null);
  const [cocsReqPending,setCocsReqPending]=useState<any[]>([]);
  const cocsStripRef=useRef<any>(null),cocsControlRef=useRef<any>(null),cocsCoachRef=useRef<any>(null),cocsBoardRef=useRef<any>({open:false,pinned:false,active:0,ids:[],cards:[],count:0,collapsed:false}),cocsBoardControlRef=useRef<any>(null),boardHoldRef=useRef<{at:number,held:boolean}>({at:0,held:false});
  // Cursor mode owns pointer lock intent for every interactive surface. The
  // machine state lives in a ref so the global key handlers (registered once)
  // and the pointer-lock listener read the live value; a mirror in React state
  // drives the HUD chip and the CLICK TO FIGHT affordance.
  const [cursorUi,setCursorUi]=useState<any>(()=>initialCursorMode());
  const cursorRef=useRef<any>(cursorUi),lockChangeAtRef=useRef(0),requestLockRef=useRef<()=>void>(()=>{});
  // F05: passive watching stays out of the cursor machine. The Tab glance and
  // the automatic death summary never register a surface; only the explicitly
  // opened variants below release the pointer.
  const [scoresInteractive,setScoresInteractive]=useState(false),[respawnEditor,setRespawnEditor]=useState(false),[respawnQueue,setRespawnQueue]=useState<any>(null);
  const scoresInteractiveRef=useRef(false),respawnEditorRef=useRef(false),respawnOpenRef=useRef(false);
  const setScoresInteractiveOpen=(open:boolean)=>{scoresInteractiveRef.current=open;setScoresInteractive(open);};
  const setRespawnEditorOpen=(open:boolean)=>{respawnEditorRef.current=open;setRespawnEditor(open);};
  // Intermission spend: a per-window local dismissal so SKIP returns to combat
  // without touching the deterministic sim (the window still closes itself).
  const [spendDismissed,setSpendDismissed]=useState<number|null>(null);
  const readoutPanelsRef=useRef<Set<string>>(new Set());
  const keyLabel=(code:string)=>bindingLabel(code);
  const moveKeys=[bindings.forward,bindings.back,bindings.left,bindings.right].map(keyLabel).join('');
  // Voice/vehicle/board prompts are resolved once per render from the live
  // bindings so every visible label and aria name agrees with input routing.
  const voiceKey=keyLabel(bindings.voice??DEFAULT_BINDINGS.voice).toUpperCase();
  const presetOptions={characters:CHARACTERS.map((c:any)=>c.id),harnesses:HARNESSES.map((h:any)=>h.id),maps:MAPS.map((m:any)=>m.id),gearSlots:GEAR_SLOTS.map((s:any)=>s.id),gearIds:GEAR.map((g:any)=>g.id),attachmentSlots:ATTACHMENT_SLOTS.map((s:any)=>s.id),attachmentIds:ATTACHMENTS.map((a:any)=>a.id),finishes:FINISH_IDS,crosshairs:CROSSHAIR_IDS};
  // WP2.3: the versioned record is read once; a legacy `token-arena-onboarded`
  // value migrates in place and is grandfathered as a completion.
  const onboardingStateRef=useRef<any>(null);
  const onboardingStore=()=>{try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}};
  useEffect(()=>{onboardingStateRef.current=readOnboardingState(onboardingStore());},[]);
  // Title-first: the coach waits for an explicit arena entry, then opens only
  // when the record says it has not been seen at this content version.
  useEffect(()=>{if(entered&&mode==='selection'&&onboarding===null&&shouldShowOnboarding(onboardingStateRef.current,true))setOnboarding(0);},[entered,mode,onboarding]);
  // WP3.2: opt-in, device-local study recorder. The log lives in a ref so the
  // render and animation closures share one instance, and a version counter
  // re-renders the settings panel when consent or contents change. No storage
  // API is touched and nothing is sent. `studyEmit` is a no-op until consent.
  const studyLogRef=useRef<any>(null),studyBuildRef=useRef('unknown'),studyInputRef=useRef<any>({touch:false,accessibility:null,display:null}),studyDeadRef=useRef(false),studyFirstActionRef=useRef(false),studyEventCursorRef=useRef<{local:number;network:number}>({local:0,network:0}),studyResultIntentRef=useRef<string|null>(null),studyMatchesRef=useRef(0);
  const [studyVersion,setStudyVersion]=useState(0);
  if(studyLogRef.current===null)studyLogRef.current=createStudyLog();
  useEffect(()=>{studyInputRef.current={touch:touchControls,accessibility,display};});
  const studyFlagSource=()=>{const {touch,accessibility:a,display:d}=studyInputRef.current||{};return {reducedMotion:d?.reducedMotion===true,highContrast:a?.highContrast===true,palette:a?.palette,captions:d?.captions===true,uiScale:d?.uiScale,touch:touch===true};};
  const studyEmit=(name:string,payload?:unknown,extra?:{journeyStage?:string;inputClass?:string;viewportBucket?:string;accessibilityFlags?:Record<string,unknown>})=>{
   let log=studyLogRef.current;if(!log?.enabled)return false;
   const ctx={now:typeof performance!=='undefined'?performance.now():0,journeyStage:extra?.journeyStage??modeRef.current,inputClass:extra?.inputClass??(studyInputRef.current?.touch?'touch':'keyboard-mouse'),viewportBucket:extra?.viewportBucket??viewportBucketFor(typeof window!=='undefined'?window.innerWidth:0),accessibilityFlags:extra?.accessibilityFlags??accessibilityFlagsFrom(studyFlagSource())};
   const append=(eventName:string,eventPayload:any)=>{const next=appendStudyEvent(log,eventName,eventPayload,ctx);if(next===log)return false;log=next;studyLogRef.current=next;return true;};
   if(!append(name,payload))return false;
   if(FIRST_STUDY_ACTIONS.has(name)&&!studyFirstActionRef.current){studyFirstActionRef.current=true;append('first_meaningful_action',{mode:String(runtime.current?.match?.config?.mode??runtime.current?.net?.state?.config?.mode??'unknown')});}
   setStudyVersion((v:number)=>v+1);
   return true;
  };
  const studyMatchStart=(mode:string,source:string,variant?:string)=>{
   const counted=variant!=='training'&&source!=='spectate',previous=Number(studyMatchesRef.current)||0;
   if(counted)studyMatchesRef.current=previous+1;
   studyDeadRef.current=false;studyFirstActionRef.current=false;studyEventCursorRef.current={local:0,network:0};
   studyEmit('match_started',{mode,source,...(variant?{variant}:{})});
   if(counted&&previous>=1)studyEmit('second_match_started',{mode,source});
  };
  // Authoritative order/spend outcomes only; ids are cursor-tracked per stream
  // so nothing is emitted twice when the match or net event log grows.
  const studyOutcomes=(events:any[]|undefined,source:'local'|'network')=>{
   if(!studyLogRef.current?.enabled||!Array.isArray(events))return;
   const cursor=studyEventCursorRef.current;let last=Number(cursor[source])||0;
   for(const event of events){const id=Number(event?.id);if(!Number.isFinite(id)||id<=last)continue;last=id;const type=String(event?.type||'');
    if(type==='cocs-order')studyEmit('order_accepted',{order:String(event?.verb??''),source});
    else if(type==='cocs-order-rejected')studyEmit('order_rejected',{order:String(event?.verb??''),source});
    else if(type==='cocs-order-complete')studyEmit('order_completed',{order:String(event?.verb??''),source});
    else if(type==='coop-spend')studyEmit('spend_resolved',{verb:String(event?.verb??''),outcome:'applied',source});
    else if(type==='coop-spend-rejected')studyEmit('spend_resolved',{verb:String(event?.verb??''),outcome:'rejected',source});
    else if(type==='cocs-buy')studyEmit('spend_resolved',{verb:'req',outcome:'applied',item:String(event?.itemId??''),source});
   }
   cursor[source]=last;
  };
  const finishOnboarding=(status:string='skipped')=>{studyEmit('onboarding_outcome',{outcome:status},{journeyStage:'onboarding'});onboardingStateRef.current=persistOnboardingState(onboardingStore(),status);setOnboarding(null);};
  const reopenOnboarding=()=>{runtime.current?.audio?.start?.();if(!enteredRef.current)enterMenu();setSettings(false);setOnboarding(0);};
  useEffect(()=>{try{setPresets(normalizePresets(JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY)||'[]'),presetOptions as any,(i:number)=>`p${i}`));}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem(PRESET_STORAGE_KEY,JSON.stringify(presets));}catch{}},[presets]);
  useEffect(()=>{try{const normalized=normalizeChallengeState(JSON.parse(localStorage.getItem(CHALLENGE_STORAGE_KEY)||'null'),currentDaySeed());challengeRef.current=normalized;setChallengeState(normalized);}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem(CHALLENGE_STORAGE_KEY,JSON.stringify(challengeState));}catch{}},[challengeState]);
  useEffect(()=>{try{setBindings(normalizeBindings(JSON.parse(localStorage.getItem(KEYBIND_STORAGE_KEY)||'null')));}catch{}},[]);
  useEffect(()=>{try{setAccessibility(normalizeAccessibility(JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)||'null')));}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem(ACCESSIBILITY_STORAGE_KEY,JSON.stringify(accessibility));}catch{}}, [accessibility]);
  // The richer accessibility palette drives the 2D UI; the 3D engine only
  // understands the coarse default/colorblind hint, so keep display in sync.
  useEffect(()=>{setDisplay((d:any)=>normalizeDisplay({...d,teamPalette:enginePaletteFor(accessibility.palette)}));},[accessibility.palette]);
  useEffect(()=>{try{setCampaign(normalizeCampaignProgress(JSON.parse(localStorage.getItem(CAMPAIGN_STORAGE_KEY)||'null')));}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem(CAMPAIGN_STORAGE_KEY,JSON.stringify(campaign));}catch{}},[campaign]);
  useEffect(()=>{const loaded=loadHistory();historyRef.current=loaded;setHistory(loaded);},[]);
  useEffect(()=>{if(runtime.current)runtime.current.bindings=bindings;try{localStorage.setItem(KEYBIND_STORAGE_KEY,JSON.stringify(bindings));}catch{}},[bindings,ready]);
  const savePreset=(name:string)=>{const loadout={gear:profileRef.current.gear,attachments:profileRef.current.attachments,finish:profileRef.current.finish,crosshair:profileRef.current.crosshair};const preset=normalizePreset({name,character,harness,mapId,config,loadout},presetOptions as any,()=>`p${Date.now().toString(36)}`);if(preset)setPresets(list=>addPreset(list,preset));};
  const loadPreset=(p:any)=>{const level=profileRef.current.level||1,raw=p.loadout||{};if(CHARACTERS.some(c=>c.id===p.character))setCharacter(p.character);if(HARNESSES.some(h=>h.id===p.harness))setHarness(p.harness);if(MAPS.some(m=>m.id===p.mapId))setMapId(p.mapId);setConfig((c:any)=>normalizeConfig({...c,...p.config,playerName:c.playerName}));const gear=normalizeGear(raw.gear,level),attachments=normalizeAttachments(raw.attachments,level),finish=FINISH_IDS.includes(raw.finish)?raw.finish:null,crosshair=CROSSHAIR_IDS.includes(raw.crosshair)?raw.crosshair:null;const saved=saveProgression({...profileRef.current,gear,attachments,finish,crosshair});if(crosshair)setDisplay((d:any)=>normalizeDisplay({...d,crosshair}));runtime.current?.net?.gear(saved.gear,saved.attachments,saved.finish);setSetupOpen(false);};
  const deletePreset=(id:string)=>setPresets(list=>removePreset(list,id));
  const modalRef=useRef<HTMLElement>(null),singleRef=useRef<HTMLElement>(null),settingsRef=useRef<HTMLElement>(null),onboardingRef=useRef<HTMLElement>(null),previewRef=useRef<HTMLElement>(null),enteredRef=useRef(false),profileRef=useRef<any>(defaultProgression()),challengeRef=useRef<any>(normalizeChallengeState({})),historyRef=useRef<any>(emptyHistory()),inviteHandled=useRef(false),demoSessionRef=useRef<any>(demoSession),demoOnlyRef=useRef(false),demoLiftRef=useRef(0),demoTrailRef=useRef<any[]>([]),demoForwardRef=useRef<any[]>([]),demoPlanRef=useRef({advance:false,restart:false}),queuedRef=useRef(false),settingsOpenerRef=useRef<HTMLElement|null>(null),resumeRef=useRef<()=>void>(()=>{});
  // Demo preferences load once and persist whenever the applied settings change.
  useEffect(()=>{let raw:string|null=null;try{raw=localStorage.getItem(DEMO_SETTINGS_KEY);}catch{}const next=applyDemoEvent(demoSessionRef.current,{type:'load-settings',settings:loadDemoSettings(raw)});demoSessionRef.current=next;setDemoSession(next);},[]);
  useEffect(()=>{try{localStorage.setItem(DEMO_SETTINGS_KEY,storeDemoSettings(demoSession.applied));}catch{}},[demoSession.applied]);
  useEffect(()=>{demoOnlyRef.current=demoOnly;},[demoOnly]);
  const [voiceState,setVoiceState]=useState<any>({enabled:false,mode:'ptt',status:'off',error:'',talking:false,peers:0}),[voiceVolume,setVoiceVolume]=useState(1),[voiceThreshold,setVoiceThreshold]=useState(.03),[voiceOpen,setVoiceOpen]=useState(false),[newMessages,setNewMessages]=useState(false);
  const voiceGate=useRef({menu:false,blurred:false}),voicePrefs=useRef({volume:1,threshold:.03}),lobbyInputRef=useRef<HTMLInputElement>(null),lobbyChatRef=useRef<HTMLDivElement>(null),chatAtBottom=useRef(true),chatRoom=useRef('');
  const syncVoice=()=>{const r=runtime.current,suppressed=voiceGate.current.menu||voiceGate.current.blurred||document.hidden||isEditable(document.activeElement)||chatOpenRef.current||!!r?.net?.spectate||!['lobby','playing'].includes(modeRef.current)||!!(modeRef.current==='lobby'&&r?.net?.started&&!r?.net?.roundOver);if(suppressed)r?.voice?.setPushToTalk(false);if(r?.voice&&r.voiceSuppressed!==suppressed){r.voiceSuppressed=suppressed;r.voice.setSuppressed(suppressed);}return !suppressed;};
  const resetChat=()=>{setChatLog([]);setChatDraft('');setNewMessages(false);chatAtBottom.current=true;chatRoom.current='';setNetRoomId('');if(runtime.current?.net)runtime.current.net.chatLog=[];};
  const syncNetInfo=()=>{const n=runtime.current?.net;setNetInfo({connected:!!n?.connected,peerId:n?.peerId??null,hostId:n?.hostId??null,isHost:!!n?.isHost,started:!!n?.started,spectate:!!n?.spectate,actorId:n?.actorId??null,roundOver:!!n?.roundOver,roomId:n?.roomId??null});};
  const refreshNet=()=>{runtime.current?.net?.list();runtime.current?.net?.history();};
  const disposeVoice=()=>{const r=runtime.current;if(!r)return;const voice=r.voice;r.voice=null;voice?.dispose();setVoiceState({enabled:false,mode:'ptt',status:'off',error:'',talking:false,peers:[]});};
  const saveProgression=(value:any)=>{const normalized=normalizeProgression(value);profileRef.current=normalized;setProfile(normalized);if(runtime.current)runtime.current.profile=normalized;try{localStorage.setItem('token-arena-progression',JSON.stringify(normalized));}catch{}return normalized;};
  const saveChallenges=(value:any)=>{const normalized=normalizeChallengeState(value);challengeRef.current=normalized;setChallengeState(normalized);try{localStorage.setItem(CHALLENGE_STORAGE_KEY,JSON.stringify(normalized));}catch{}return normalized;};
  const saveMatchHistory=(result:any,actor:any,meta:any)=>{const entry=historyEntryFromResult({...result,actor},meta);const next=saveHistory(recordMatch(historyRef.current,entry));historyRef.current=next;setHistory(next);return entry;};
  const clearHistory=()=>{const next=saveHistory(emptyHistory());historyRef.current=next;setHistory(next);};
  // WP2.1: capture the exact opener synchronously. A lower dialog becomes inert
  // in the same commit that opens Settings, and inert drops focus to <body>, so
  // reading document.activeElement later would lose the button to restore to.
  const openSettings=(tab:string='game',opener?:HTMLElement|null)=>{settingsOpenerRef.current=opener??(typeof document!=='undefined'&&document.activeElement instanceof HTMLElement?document.activeElement:null);setSettingsTab(tab);setSettings(true);};
  const unlock=unlockQueue[0]??null;
  const achievement=achievementQueue[0]??null;
  const enqueueUnlocks=(items:any[],gained:number)=>{const list=(Array.isArray(items)?items:[]).filter(Boolean);if(!list.length)return;setUnlockQueue(q=>[...q,...list.map((item,i)=>({...item,gained:q.length===0&&i===0?Number(gained)||0:undefined}))]);};
  const enqueueAchievements=(items:any[])=>{const list=(Array.isArray(items)?items:[]).filter(Boolean);if(!list.length)return;setAchievementQueue(q=>[...q,...list]);};
  const dismissAchievement=()=>setAchievementQueue(q=>q.slice(1));
  useEffect(()=>{voiceGate.current.menu=settings||setupOpen;syncVoice();},[settings,setupOpen,chatOpen,mode]);
  useEffect(()=>{chatAtBottom.current=true;setNewMessages(false);},[mode,netRoomId]);
  useEffect(()=>{if(mode!=='lobby')return;const frame=requestAnimationFrame(()=>{const el=lobbyChatRef.current;if(!el)return;if(chatAtBottom.current){el.scrollTop=el.scrollHeight;setNewMessages(false);}else setNewMessages(true);});return()=>cancelAnimationFrame(frame);},[chatLog,mode,netRoomId]);
 const chatInputRef=useRef<HTMLInputElement>(null),chatOpenRef=useRef(false);
  useEffect(()=>{chatOpenRef.current=chatOpen;syncCursorSurface(CURSOR_SURFACE.CHAT,chatOpen);if(chatOpen){clearInput();chatInputRef.current?.focus();}else if(modeRef.current==='playing'){canvas.current?.focus({preventScroll:true});setPointerHint(document.pointerLockElement!==canvas.current);}},[chatOpen]);
  const selectedMode=GAME_MODES.find(m=>m.id===config.mode)!;
  const selectedMap=getMap(mapId),selectableMaps=[...mapsForMode(config.mode,{legacy:legacyMaps})].sort((a:any,b:any)=>Number(Boolean(b.nextGen))-Number(Boolean(a.nextGen)));
  const mapViewBox=(map:any)=>{const b=map.bounds;if(!b)return '-15 -15 30 30';const width=b.maxX-b.minX,depth=b.maxZ-b.minZ,p=Math.max(2,Math.max(width,depth)*.04);return `${b.minX-p} ${b.minZ-p} ${width+p*2} ${depth+p*2}`;};
 const selected=CHARACTERS.find((c:any)=>c.id===character)!,power=HARNESSES.find((h:any)=>h.id===harness)!;
 const myPeerId=runtime.current?.net?.peerId;
   const clearInput=()=>{if(!scoresInteractiveRef.current)setScores(false);const r=runtime.current;if(!r)return;r.keys.clear();r.fire=r.fireTap=r.jump=r.power=r.interact=r.drag=r.ads=r.reload=r.melee=false;r.grenade=false;if(r.touch){r.touch.moveX=0;r.touch.moveY=0;r.touch.sprint=false;r.touch.jump=false;r.touch.crouch=false;r.touch.fire=false;r.touch.ads=false;r.touch.mobility=false;}r.voice?.setPushToTalk(false);r.inputWeapon=-1;r.acc=0;if(r.net?.connected&&r.net.started&&!r.net.spectate)r.net.input({x:0,z:0,fire:false,jump:false,power:false,interact:false,sprint:false,crouch:false,ads:false,mobility:false,reload:false,melee:false,grenade:false});};
   // --- Cursor mode ---------------------------------------------------------
   // `game/cursor-mode.mjs` decides when the pointer must be free; this adapter
   // performs the browser side effects (exit/request lock, clear combat inputs)
   // and mirrors the state for the HUD. Every surface below registers through
   // `syncCursorSurface` so there is exactly one owner of pointer lock.
   const applyCursor=(result:any)=>{
    if(!result)return result;
    if(result.effects?.clearInput)clearInput();
    cursorRef.current=result.state;setCursorUi(result.state);
    if(result.effects?.unlock)document.exitPointerLock?.();
    if(result.effects?.lock)requestLockRef.current?.();
    return result;
   };
   const syncCursorSurface=(surface:string,active:boolean)=>{
    const current=cursorRef.current;
    if(active===current.surfaces.includes(surface))return;
    applyCursor(active?cursorOpen(current,surface):cursorClose(current,surface));
   };
   const resetCursorMode=()=>{const next=cursorReset(cursorRef.current);if(next.changed){cursorRef.current=next.state;setCursorUi(next.state);}};
   const toggleCursorMode=()=>{if(modeRef.current!=='playing'||demoOnlyRef.current)return false;const result=cursorToggle(cursorRef.current,CURSOR_SURFACE.FREE);if(!result.changed)return false;applyCursor(result);return true;};
   // WP1.1: Tab stays inside the surface that owns the cursor. The command
   // board, spend window and Training card are real DOM panels, so focus can
   // move between their controls without opening standings or seeding combat
   // input. Surfaces without a scoped panel keep the old suppression.
   const surfaceFocusSelectors:Record<string,string>={[CURSOR_SURFACE.BOARD]:'.cocs-board',[CURSOR_SURFACE.SPEND]:'.cocs-spend',[CURSOR_SURFACE.TRAINING]:'[data-training-phase]'};
   const cycleSurfaceFocus=(surface:string,shift:boolean)=>{
    const selector=surfaceFocusSelectors[surface];if(!selector)return false;
    const host=document.querySelector<HTMLElement>(selector);if(!host)return false;
    const focusable=[...host.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length>0);
    if(!focusable.length)return false;
    const active=document.activeElement as HTMLElement|null,index=active?focusable.indexOf(active):-1;
    const next=shift?focusable[index<=0?focusable.length-1:index-1]:focusable[index<0||index>=focusable.length-1?0:index+1];
    next?.focus();
    return Boolean(next);
   };
   // One obvious way back: only when no explicit surface holds the cursor. The
   // pinned standings has no close control of its own, so a click dismisses it
   // and keeps the free cursor where it was (F05).
   const cursorResumeCombat=()=>{
    const current=cursorRef.current;
    if(cursorKeyboardOwner(current)===CURSOR_SURFACE.SCOREBOARD){setScoresInteractiveOpen(false);setScores(false);return;}
    if(cursorActive(current)&&!cursorBlockingSurfaces(current).length)applyCursor(cursorClear(current));
    else if(!cursorActive(current))requestLockRef.current?.();
   };
   const toggleReadoutPanel=(id:string,open:boolean)=>{
    const set=readoutPanelsRef.current,had=set.size>0;
    if(open)set.add(id);else set.delete(id);
    const has=set.size>0;
    if(has!==had)syncCursorSurface(CURSOR_SURFACE.TERMINALS,has);
   };
   const changeMode=(m:Mode)=>{if(modeRef.current==='results'&&m!=='results'){studyEmit('result_action_selected',{action:studyResultIntentRef.current||'leave-results'});studyResultIntentRef.current=null;}studyEmit('surface_viewed',{surface:m},{journeyStage:m});if(m==='results')studyEmit('results_viewed',{mode:String(hud?.config?.mode??'unknown')},{journeyStage:'results'});runtime.current?.voice?.setPushToTalk(false);runtime.current?.voice?.setSuppressed(true);if(runtime.current)runtime.current.voiceSuppressed=true;cocsCoachRef.current=null;modeRef.current=m;setMode(m);setChatOpen(false);setSetupOpen(false);setSettings(false);clearInput();resetCursorMode();if(m!=='playing'){document.exitPointerLock?.();setPointerHint(false);}setScores(false);setScoresInteractiveOpen(false);setRespawnEditorOpen(false);};
    const enterMenu=()=>{enteredRef.current=true;setEntered(true);setDemoOnly(false);runtime.current?.audio?.start?.();};
    const exitToTitle=()=>{runtime.current?.voice?.setPushToTalk(false);if(modeRef.current!=='selection')changeMode('selection');enteredRef.current=false;setEntered(false);setDemoOnly(false);setHud(null);setSetupOpen(false);setSettings(false);document.exitPointerLock?.();};
  const touchLook=(dx:number,dy:number)=>{const r=runtime.current;if(!r)return;if(demoOnlyRef.current&&demoSessionRef.current.state==='free'){const d=r.display||{},scale=.004*(r.lookSensitivity||1);demoFreeAdapter(r.view).look(-dx*scale,(d.invertY?1:-1)*dy*scale);return;}if(modeRef.current!=='playing'||chatOpenRef.current||r.net?.spectate||r.spectateLocal)return;const look=r.net?.started?r.look:r.match?.actors?.[0],d=r.display||{};if(look)applyLook(look,dx,dy,r.lookSensitivity*(d.touchSensitivity??1)*((r.ads||r.touch?.ads)?(d.adsSensitivity??1):1),d.invertY===true);};
  const touchSwap=()=>{const r=runtime.current;if(!r||modeRef.current!=='playing')return;const p=r.net?.started?r.renderState?.actors?.find((a:any)=>a.id===r.net.actorId):r.match?.actors?.[0];if(!p)return;const n=cycleWeapon(p.ammo,p.weapon,r.inputWeapon,1);if(n>=0)r.inputWeapon=n;};
  const touchPause=()=>{const r=runtime.current;if(!r)return;changeMode(r.net?.started?'lobby':'paused');};
  const toggleFullscreen=()=>{const doc:any=document;try{if(doc.fullscreenElement||doc.webkitFullscreenElement){(doc.exitFullscreen||doc.webkitExitFullscreen)?.call(doc);return;}const el:any=doc.documentElement,req=el.requestFullscreen||el.webkitRequestFullscreen;const result=req?.call(el,{navigationUI:'hide'});result?.catch?.(()=>{});}catch{}};
  // --- Back to Demo session ---------------------------------------------------
  // The pure state machine lives in game/demo-session.mjs; the page only mirrors
  // its plain objects into React state (once per scenario/transition, never per
  // frame) and performs the side effects that need a live runtime: view/director
  // ownership and match builds through the existing showcase factory.
  const commitDemoSession=(next:any)=>{if(!next||next===demoSessionRef.current)return demoSessionRef.current;demoSessionRef.current=next;setDemoSession(next);return next;};
  const demoFreeAdapter=(view:any)=>{
   const api=view??{};
   return {
    set:(on:boolean)=>{api.setFreeCam?.(on);},
    look:(yaw:number,pitch:number)=>{api.freeLook?.(yaw,pitch);},
    move:(dt:number,input:any)=>{
     // Prefer the newer view.freeMove when it lands; freeCamStep mirrors the
     // historical updateFreeCam math (plus adjustable speed) until then.
     if(typeof api.setFreeCamSpeed==='function'&&typeof input?.speed==='number')api.setFreeCamSpeed(input.speed);if(typeof api.freeMove==='function'){api.freeMove({forward:input?.forward??0,right:input?.right??0,up:input?.up??0,boost:input?.boost===true},dt);return;}
     const pose=api.freePose;if(!pose)return;
     const next=freeCamStep(pose,dt,input);
     pose.x=next.x;pose.y=next.y;pose.z=next.z;pose.pitch=next.pitch;
    },
    reset:()=>{api.resetFreeCam?.();},
   };
  };
   const clearDemoInputs=()=>{const r=runtime.current;if(!r)return;demoLiftRef.current=0;r.keys?.clear?.();r.fire=r.fireTap=r.jump=r.power=r.interact=r.ads=r.reload=r.melee=r.grenade=r.drag=false;if(r.touch){r.touch.moveX=0;r.touch.moveY=0;r.touch.sprint=false;r.touch.jump=false;r.touch.crouch=false;r.touch.ads=false;r.touch.fire=false;r.touch.mobility=false;}};
  const demoFreeInput=()=>{
   const r=runtime.current,session=demoSessionRef.current;
   if(!r)return {forward:0,right:0,up:0,boost:false,speed:session.freeSpeed};
   const b=r.bindings||bindings,keys=r.keys||new Set<string>(),t=r.touch||{};
   const axis=(value:number)=>Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
   return {
    forward:axis((keys.has(b.forward)?1:0)-(keys.has(b.back)?1:0)+(Number.isFinite(t.moveY)?t.moveY:0)),
    right:axis((keys.has(b.right)?1:0)-(keys.has(b.left)?1:0)+(Number.isFinite(t.moveX)?t.moveX:0)),
    up:axis((keys.has(b.jump)?1:0)-(keys.has(b.crouch)?1:0)+demoLiftRef.current+(t.crouch?-1:0)),
    boost:keys.has(b.sprint)||t.sprint===true,
    speed:session.freeSpeed,
   };
  };
  const applyDemoCameraOwnership=(session:any)=>{
   const r=runtime.current,view=r?.view;if(!view)return;
   if(session?.state==='free'){demoFreeAdapter(view).set(true);return;}
   demoFreeAdapter(view).set(false);
   const following=session?.state==='follow'&&session.subjectId!==null&&session.subjectId!==undefined;
   // Follow is a manual ownership claim on the view: the helper keeps the
   // spectator and director targets in sync, so releasing it as soon as the
   // session leaves the state stops a stale follow outliving the demo.
   if(!following&&view.manualFollow!=null)view.clearManualFollow?.();
   const sc=r.showcase,director=sc?.director;
   if(!director)return;
   if(session?.cameraStyle&&session.cameraStyle!=='auto'){
    if(view.cameraOwner!=='manual')view.setCameraOwner?.('manual');
    director.setRig?.(session.cameraStyle);
    if(following)director.setTarget?.(session.subjectId);
   }
   else{
    // Style "auto" hands the rig back to the planner. The owner is only touched
    // when it actually differs: an ownership switch drops cached camera state,
    // so re-asserting it on an unchanged state would churn the hand-off.
    director.reframe?.(sc.match?.snapshot?.());
    if(following){
     if(typeof view.setManualFollow==='function')view.setManualFollow(session.subjectId);
     else{if(view.cameraOwner!=='manual')view.setCameraOwner?.('manual');director.setTarget?.(session.subjectId);}
    }
    else if(view.cameraOwner!=='auto')view.setCameraOwner?.('auto');
   }
  };
  const demoTransition=(event:any)=>{const committed=commitDemoSession(applyDemoEvent(demoSessionRef.current,event));applyDemoCameraOwnership(committed);return committed;};
  const pushTrail=(list:any[],spec:any)=>{if(!spec)return list;list.push(spec);while(list.length>16)list.shift();return list;};
  const buildDemoShowcase=(spec:any=null)=>{
   const r=runtime.current;if(!r?.buildShowcase)return false;
   const ok=r.buildShowcase(spec??undefined)===true;
   if(!ok)commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'error',message:'That scenario could not start. Keeping the running demo.'}));
   // A build drops the view back to automatic ownership; re-assert the session's
   // camera style/follow so a scenario change cannot silently steal the frame.
   else applyDemoCameraOwnership(demoSessionRef.current);
   return ok;
  };
  const selectDemoScenario=(rng:any)=>{
   const r=runtime.current;
   const picked=pickDemoScenario(demoSessionRef.current,{rng,legacy:r?.legacyArenas===true,afterEnd:true});
   commitDemoSession(picked.session);
   return picked.spec;
  };
  const skipDemoScenario=(dir:number)=>{
   const r=runtime.current;if(!r?.buildShowcase)return;
   if(dir<0){const previous=demoTrailRef.current.pop();if(previous){pushTrail(demoForwardRef.current,r.showcaseSpec);buildDemoShowcase(previous);return;}}
   else{const next=demoForwardRef.current.pop();if(next){pushTrail(demoTrailRef.current,r.showcaseSpec);buildDemoShowcase(next);return;}}
   commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'release-pins',rotation:true}));
   buildDemoShowcase();
  };
  const demoFollow=(dir:number)=>{
   const snapshot=runtime.current?.showcase?.match?.snapshot?.();
   const subject=nextDemoSubject(demoSessionRef.current,snapshot,dir);
   if(subject)demoTransition({type:'follow',actorId:subject.id,actorName:subject.name});
  };
  const demoToggleFree=()=>{demoTransition({type:demoSessionRef.current.state==='free'?'auto':'free'});};
  const demoCycleStyle=(dir:number)=>demoTransition({type:'cycle-camera',dir});
  const demoCycleSpeedPref=(dir:number)=>demoTransition({type:'cycle-speed',dir});
  const demoResetView=()=>{const session=demoSessionRef.current;if(session.state==='free'){demoFreeAdapter(runtime.current?.view).reset();return;}demoTransition({type:'auto'});};
  const demoToggleHud=()=>demoTransition({type:'toggle-hud'});
  const demoTogglePause=()=>demoTransition({type:demoSessionRef.current.state==='paused'?'resume':'pause'});
  const demoReleasePins=()=>demoTransition({type:'release-pins',rotation:true});
  const openDemoOptions=()=>{clearDemoInputs();document.exitPointerLock?.();demoFreeAdapter(runtime.current?.view).set(false);demoTransition({type:'open-options'});};
  const closeDemoOptions=()=>demoTransition({type:'close-options'});
  const demoSetDraft=(patch:any)=>commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'set-draft',patch}));
  const demoSetSelection=(selection:any)=>commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'set-selection',selection}));
  const demoResetDraft=()=>commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'reset-draft'}));
  const demoApplyOptions=(start:boolean)=>{
   const r=runtime.current;
   const result=applyDemoOptions(demoSessionRef.current,{legacy:r?.legacyArenas===true});
   if(!result.ok){commitDemoSession(result.session);return false;}
   commitDemoSession(result.session);
   demoForwardRef.current=[];
   demoTrailRef.current=[];
   if(start||result.selectionChanged)buildDemoShowcase();
   else applyDemoCameraOwnership(result.session);
   return true;
  };
  const enterArenaFromDemo=()=>{clearDemoInputs();document.exitPointerLock?.();demoFreeAdapter(runtime.current?.view).set(false);const exited=commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'exit'}));applyDemoCameraOwnership(exited);enterMenu();};
  const backToDemo=()=>{const r=runtime.current;exitToTitle();const current=demoSessionRef.current;const fresh=createDemoSession({settings:current.applied,hudVisible:current.hudVisible,state:'auto'});commitDemoSession({...fresh,rotation:current.rotation,coverage:current.coverage,selection:{...current.selection}});setDemoOnly(true);demoOnlyRef.current=true;r?.audio?.start?.();r?.view?.setWeather?.(demoWeather);if(r&&r.showcaseEnabled!==false&&!r.showcase)buildDemoShowcase();else applyDemoCameraOwnership(demoSessionRef.current);};
  const saveDemoPrefs=(patch:any)=>{try{const prefs=JSON.parse(localStorage.getItem('token-arena-settings')||'{}');localStorage.setItem('token-arena-settings',JSON.stringify({...prefs,...patch}));}catch{}};
  const setMusicPref=(on:boolean)=>{setDemoMusic(on);const r=runtime.current;r?.audio?.setMusicEnabled?.(on);if(on)r?.audio?.unlock?.();setAudioNotice(on&&r?.audio?.audioStatus?.().state!=='running'?'Audio is blocked by the browser. Click or press a key to enable it.':'');saveDemoPrefs({music:on});};
  const setAudioVolume=(kind:'master'|'music'|'effects'|'ambience',v:number)=>{const r=runtime.current;if(kind==='music')setMusicVolume(v);else if(kind==='effects')setEffectsVolume(v);else if(kind==='ambience')setAmbienceVolume(v);r?.audio?.setVolume?.(kind,v);try{const prefs=JSON.parse(localStorage.getItem('token-arena-settings')||'{}');localStorage.setItem('token-arena-settings',JSON.stringify({...prefs,[`${kind}Volume`]:v}));}catch{}};
  const previewMusic=()=>{const r=runtime.current;r?.audio?.previewMusic?.('menu',6);const s=r?.audio?.audioStatus?.();setAudioNotice(s&&s.state!=='running'?'Audio is blocked by the browser. Click or press a key to enable it.':'Now previewing the soundtrack.');return s??null;};
  const setAmbiencePref=(on:boolean)=>{setDemoAmbience(on);runtime.current?.audio?.setAmbient?.(on);saveDemoPrefs({ambience:on});};
  const setAnnouncerPref=(on:boolean)=>{setDemoAnnouncer(on);runtime.current?.audio?.setAnnouncer?.(on);saveDemoPrefs({announcer:on});};
  const cycleWeather=()=>{const list:(string|null)[]=[null,...WEATHER_KINDS];const next=list[(list.indexOf(demoWeather)+1)%list.length]??null;setDemoWeather(next);runtime.current?.view?.setWeather?.(next);saveDemoPrefs({weather:next});};
  const setTouchPref=(value:boolean)=>{setTouchControls(value);try{const prefs=JSON.parse(localStorage.getItem('token-arena-settings')||'{}');localStorage.setItem('token-arena-settings',JSON.stringify({...prefs,touch:value}));}catch{}};
  const setVoicePref=(patch:{volume?:number;threshold?:number})=>{Object.assign(voicePrefs.current,patch);try{const prefs=JSON.parse(localStorage.getItem('token-arena-settings')||'{}');localStorage.setItem('token-arena-settings',JSON.stringify({...prefs,voiceVolume:voicePrefs.current.volume,voiceThreshold:voicePrefs.current.threshold}));}catch{}};
 useEffect(()=>{let cancelled=false,raf=0;const keys=new Set<string>();let view:any,audio:any;let resize:()=>void=()=>{};
    (async()=>{try{const module=await import('../game/view.mjs');if(cancelled)return;view=new module.ArenaView(canvas.current);audio=new module.SynthAudio({announcer:true});audio.setSoundtrack('halo');
    // Deferred Moth audio mount: the bank/player need a live AudioContext, which
    // SynthAudio creates on the first user gesture (start()). The factory runs
    // once, builds the layer against the real context and buses, and attaches it
    // with setMothAudio. Reduced motion constructs it inert (no new sounds), and
    // the host toggle forwards through setMothEnabled.
    audio.setMothAudioFactory?.((ctx:any)=>{const reduced=reducedMotion();if(!ctx||typeof ctx.decodeAudioData!=='function'||typeof fetch!=='function')return null;const bank=new MothAudioBank({ctx,maxBytes:8*1024*1024,reducedMotion:reduced});return new MothAudio({ctx,bank,destinations:{ambience:audio.ambienceBus,effects:audio.effectsBus},sceneBeds:{menu:'bed-ritual',explore:'bed-ritual',combat:null},gain:.4,reducedMotion:reduced});});
    const mothMotifData=mothMotif('moth-oracle');if(mothMotifData)audio.setMotif(mothMotifData);const cavernIr=mothIr('cavern');if(cavernIr?.url)audio.setReverbUrl(cavernIr.url,0.30);view.setAudio(audio);const r:any={view,audio,keys,match:null,fire:false,fireTap:false,jump:false,power:false,interact:false,ads:false,reload:false,melee:false,grenade:false,acc:0,lastAudio:0,lookSensitivity:1,hadLock:false,drag:false,fps:0,frames:0,sample:performance.now(),lastDamage:-10,lastHit:-10,lastCritical:-10,lastKill:-10,pickupText:'',pickupAt:-10,damageNumbers:[],damageDir:null,damageDirAt:-10,prevScores:null,announceCue:null,announceAt:-10,killTimes:[],killCue:null,killCueAt:-10,caption:null,captionAt:-10,damageSerial:0,net:null,netViewReady:false,renderState:null,spectateTarget:null,look:{yaw:0,pitch:0},display:null,touch:{moveX:0,moveY:0,sprint:false,crouch:false,mobility:false},inputWeapon:-1,showcase:null,showcaseEnabled:true,showcaseMatchedId:null,recorder:null,demo:null,saveRecording:null,buildShowcase:null,refreshDemos:null,playDemo:null,stopDemo:null,removeDemo:null,spectateLocal:false,cameraMode:'auto',spectateDirector:null,cocsOrders:[],cocsSpends:[],cocsSpendSeq:0,cocsBuys:[],cocsBuySeq:0,cocsBuysPending:[],cocsStrip:cocsStripState()};runtime.current=r;r.perf=new PerfTracker();modeRef.current='selection';setMode('selection');setHud(null);
  try{const saved=JSON.parse(localStorage.getItem('token-arena-customization')||'{}');const savedDisplay=normalizeDisplay(saved.display);setConfig(normalizeConfig(saved.config));setDisplay(savedDisplay);reducedOverride=savedDisplay.reducedMotion===true;view.setDisplay(savedDisplay);if(MAPS.some(m=>m.id===saved.mapId))setMapId(saved.mapId);}catch{}
 try{const prefs=JSON.parse(localStorage.getItem('token-arena-settings')||'{}');if(typeof prefs.sensitivity==='number'){r.lookSensitivity=Math.max(.3,Math.min(2.5,Number.isFinite(prefs.sensitivity)?prefs.sensitivity:1));setSensitivity(r.lookSensitivity);}if(typeof prefs.muted==='boolean'){audio.setMuted(prefs.muted);setMuted(prefs.muted);}if(typeof prefs.musicVolume==='number'){audio.setVolume('music',prefs.musicVolume);setMusicVolume(Math.max(0,Math.min(1,prefs.musicVolume)));}if(typeof prefs.effectsVolume==='number'){audio.setVolume('effects',prefs.effectsVolume);setEffectsVolume(Math.max(0,Math.min(1,prefs.effectsVolume)));}if(typeof prefs.ambienceVolume==='number'){audio.setVolume('ambience',prefs.ambienceVolume);setAmbienceVolume(Math.max(0,Math.min(1,prefs.ambienceVolume)));}if(typeof prefs.masterVolume==='number')audio.setVolume('master',prefs.masterVolume);if(typeof prefs.showcase==='boolean'){r.showcaseEnabled=prefs.showcase;setShowcase(prefs.showcase);}if(typeof prefs.legacyArenas==='boolean'){r.legacyArenas=prefs.legacyArenas;setLegacyMaps(prefs.legacyArenas);}if(typeof prefs.voiceVolume==='number'&&Number.isFinite(prefs.voiceVolume)){const v=Math.max(0,Math.min(1,prefs.voiceVolume));voicePrefs.current.volume=v;setVoiceVolume(v);}if(typeof prefs.voiceThreshold==='number'&&Number.isFinite(prefs.voiceThreshold)){const v=Math.max(0,Math.min(1,prefs.voiceThreshold));voicePrefs.current.threshold=v;setVoiceThreshold(v);}if(typeof prefs.music==='boolean'){audio.setMusicEnabled(prefs.music);setDemoMusic(prefs.music);}if(typeof prefs.ambience==='boolean'){audio.setAmbient(prefs.ambience);setDemoAmbience(prefs.ambience);}if(typeof prefs.announcer==='boolean'){audio.setAnnouncer(prefs.announcer);setDemoAnnouncer(prefs.announcer);}if(prefs.weather===null||WEATHER_KINDS.includes(prefs.weather)){const weather=prefs.weather===null?null:prefs.weather;setDemoWeather(weather);view.setWeather(weather);}}catch{}
  try{const saved=JSON.parse(localStorage.getItem('token-arena-progression')||'null');const normalized=normalizeProgression(saved);r.profile=normalized;profileRef.current=normalized;setProfile(normalized);}catch{}
  resize=()=>view.resize();window.addEventListener('resize',resize);let last=performance.now(),hudAt=0;
  const makeRng=(seed:number=Date.now()>>>0)=>{let n=seed||1;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
  const showcaseOk=()=>r.showcaseEnabled!==false&&view.renderer.isSoftware!==true;
    const buildShowcase=buildShowcaseFactory({r,view,showcaseOk,makeRng,pickShowcase,normalizeConfig,DEFAULT_CONFIG,Match,seatShowcaseVehicles,RULES,CinematicDirector,reducedMotion,setShowcaseLive,selectScenario:selectDemoScenario,onError:(error:any)=>{commitDemoSession(applyDemoEvent(demoSessionRef.current,{type:'error',message:`Scenario build failed: ${String(error?.message||error)}. Keeping the running demo.`}));}});
  // Prepare the selected arena + starting weapon before gameplay is comfortable:
  // build the viewmodel, create the post variants and compile shaders. Bounded
  // and token-guarded so rapid map changes cannot clobber a newer preparation and
  // a slow renderer never blocks the match.
  const warmScene=(target:any,weapon:number)=>{if(!target?.view?.prepareScene)return;target.warmupToken=(target.warmupToken||0)+1;const token=target.warmupToken;target.preparing=true;const finish=()=>{if(target.warmupToken===token)target.preparing=false;};try{const pending=target.view.prepareScene({weapon:Number.isInteger(weapon)?weapon:0});if(pending&&typeof pending.then==='function')pending.then(finish).catch(finish);else finish();}catch{finish();}setTimeout(finish,4500);};
  r.warmScene=(weapon:number)=>warmScene(r,weapon);
  const refreshDemos=async()=>{try{setDemos(await listDemos());}catch{setDemos([]);}};
  const saveRecording=async(demo:any)=>{if(!demo)return;const summary=await saveDemo(demo).catch(()=>null);if(summary)setLastDemo(summary);refreshDemos();};
  const playDemo=async(target:any)=>{const id=target&&typeof target==='object'?target.id:target;try{const demo=await getDemo(id);if(!demo){setDemoNotice('That demo could not be loaded.');return;}const player=new DemoPlayer(demo);const director=new CinematicDirector({random:Math.random,center:{x:0,z:0},radius:16,cutEvery:4,reduced:reducedMotion()});r.demo={player,director,time:0,paused:false,speed:1,lastT:0,hudAt:0,state:player.sample(0)};view.setMatch(player.sample(0));view.lastEvent=0;view.setPlayerId(-1);view.setSpectator(true);view.setDirector(director);view.setCinema(true);view.setShowcase(null);view.setPreviewRect(null);setDemoInfo(demoSummary(demo));setDemoRig(director.rig);setDemoTime(0);setDemoPaused(false);setDemoSpeed(1);setDemoNotice('');setDemoPlaying(true);changeMode('theater');}catch(e:any){setDemoNotice(String(e?.message||e));}};
  const stopDemo=()=>{r.demo=null;r.showcaseMatchedId=null;setDemoPlaying(false);view.setSpectator(false);view.setCinema(false);view.setDirector(null);view.setShowcase(null);view.setPreviewRect(null);changeMode('selection');};
  const removeDemo=async(id:string)=>{await deleteDemo(id).catch(()=>{});refreshDemos();};
  // Replay export downloads the demo as a JSON file; import reads a picked file
  // back into the local library. Both are browser-only and fail soft with a
  // notice so the Theater never throws on a bad file.
  const exportDemoFile=async(id:string)=>{try{const demo=await getDemo(id);if(!demo){setDemoNotice('That replay could not be loaded.');return;}const {name,text}=exportDemo(demo);const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);setDemoNotice(`Exported ${name}.`);}catch(e:any){setDemoNotice(`Export failed: ${String(e?.message||e)}`);}};
  const importDemoFile=async(file:any)=>{if(!file)return;try{const text=await file.text();const summary=await importDemoToStore(text);setLastDemo(summary);await refreshDemos();setDemoNotice(`Imported ${summary.mapName||summary.modeName||'replay'}.`);}catch(e:any){setDemoNotice(`Import failed: ${String(e?.message||e)}`);}};
  r.buildShowcase=buildShowcase;r.makeRng=makeRng;r.refreshDemos=refreshDemos;r.saveRecording=saveRecording;r.playDemo=playDemo;r.stopDemo=stopDemo;r.removeDemo=removeDemo;r.exportDemoFile=exportDemoFile;r.importDemoFile=importDemoFile;
  if(r.showcaseEnabled)buildShowcase();
  // Warm shader variants in the background so the first match frame does not
  // stall compiling them. compileAsync is used when available; the promise is
  // deliberately not awaited so the loading state is not held up.
  try{view.warmup?.();}catch{}
   const noteDamage=(e:any,snap:any,localId:number)=>{if(e.type!=='damage')return;const actors=snap?.actors??[],local=actors.find((a:any)=>a.id===localId)||actors[0];
    if(e.actor===localId){const source=e.pos??actors.find((a:any)=>a.id===e.source),bearing=local&&source?damageBearing(local,source):null;r.damageDir=bearing?{angle:bearing.angle,hasSource:true}:{angle:0,hasSource:false};r.damageDirAt=Number(snap?.time)||0;}
    if(e.source===localId&&e.actor!==localId){const victim=actors.find((a:any)=>a.id===e.actor);if(victim&&view?.camera&&canvas.current){const rect=canvas.current.getBoundingClientRect(),screen=projectToScreen(view.camera,rect,{x:victim.x,y:(victim.y??0)+1.1,z:victim.z});if(screen)r.damageNumbers=boundList(r.damageNumbers,{id:++r.damageSerial,x:screen.x,y:screen.y,amount:Math.max(1,Math.round(Number(e.amount)||0)),critical:Boolean(e.critical||e.headshot||Number(e.amount)>=48),kill:victim.health<=0,born:performance.now()},12);}}};
    const noteKill=(e:any,localId:number,time:number)=>{if(e.type==='killstreak'){if(e.actor===localId){const cue=killstreakCallout(e);if(cue){r.killCue=cue;r.killCueAt=time;audio?.announcerCue?.('killstreak');}}return;}if(e.type!=='death')return;if(e.actor===localId){r.killTimes=[];return;}if(!e.self&&e.killer===localId&&e.actor!==localId){r.lastKill=time;r.killTimes.push(time);if(r.killTimes.length>99)r.killTimes.shift();const cue=killCallout(r.killTimes,time);if(cue){r.killCue=cue;r.killCueAt=time;audio?.announcerCue?.(cue.kind==='spree'?'spree':'multikill');}}};
   const decorate=(snap:any,extra:any,stamp:number)=>{const cue=scoreAnnouncer(snap,r.prevScores);if(cue){r.announceCue=cue;r.announceAt=Number(snap?.time)||0;audio?.announcerCue?.(cue.kind);}if(snap?.teamScores)r.prevScores={0:Number(snap.teamScores[0])||0,1:Number(snap.teamScores[1])||0};const time=Number(snap?.time)||0;r.damageNumbers=r.damageNumbers.filter((n:any)=>stamp-n.born<700);return {...snap,damageDir:r.damageDir,damageDirAt:r.damageDirAt,damageNumbers:r.damageNumbers.slice(),scoreCue:r.announceCue&&time-r.announceAt<(Number(r.announceCue?.ttl)>0?Number(r.announceCue.ttl):1.6)?{...r.announceCue,age:time-r.announceAt}:null,killCue:r.killCue&&time-r.killCueAt<2?{...r.killCue,age:time-r.killCueAt}:null,caption:r.caption&&time-r.captionAt<2.2?r.caption:null,preparing:r.preparing===true,...extra};};
     r.applySpectateCamera=(dt:number)=>{const mode=r.cameraMode||'auto';if(mode==='free'){r.view.setFreeCam(true);const forward=(keys.has(bindings.forward)?1:0)-(keys.has(bindings.back)?1:0),right=(keys.has(bindings.right)?1:0)-(keys.has(bindings.left)?1:0),up=(keys.has(bindings.jump)?1:0)-(keys.has(bindings.crouch)?1:0),boost=keys.has(bindings.sprint);r.view.updateFreeCam(dt,{forward,right,up,boost});}else{r.view.setFreeCam(false);const rig=cameraModeRig(mode);if(rig){r.spectateDirector?.setAutoCut(false);r.spectateDirector?.setRig(rig);}else r.spectateDirector?.setAutoCut(true);}};
   const loop=(now:number)=>{if(cancelled)return;try{if(r.benchmarking){last=now;raf=requestAnimationFrame(loop);return;}const elapsed=Math.max(0,Math.min(.1,(now-last)/1000));last=now;r.frames++;if(now-r.sample>=1000){r.fps=Math.round(r.frames*1000/(now-r.sample));r.frames=0;r.sample=now;}
    // Drive the soundtrack every frame regardless of mode so menu music keeps
    // playing while the game loop is idle, and pick the arrangement from the
    // current screen. Scheduling itself is driven by the AudioContext clock.
    r.audio?.setScene?.(['playing','paused','results'].includes(modeRef.current)?'game':'menu');
    r.audio?.tick?.();
   if(modeRef.current==='playing'&&r.net?.started&&!r.net.roundOver){
    if(!r.netViewReady){const own=(r.net.state?.actors??[]).find((a:any)=>a.id===r.net.actorId);if(own)r.look={yaw:own.yaw,pitch:own.pitch};}
   r.acc=Math.min(r.acc+elapsed,RULES.dt*5);let guard=0;
   if(!r.net.spectate&&r.net.resynced){while(r.acc>=RULES.dt&&guard<5){r.acc-=RULES.dt;guard++;
    const input:any=controlsFromState({keys,touch:r.touch,look:r.look,move:r.touch?{x:r.touch.moveX||0,y:r.touch.moveY||0}:null,sprint:r.touch?.sprint===true,crouch:r.touch?.crouch===true,mobility:r.touch?.mobility===true,fire:r.fire,fireTap:r.fireTap,jump:r.jump,power:r.power,interact:r.interact,weapon:r.inputWeapon,ads:r.ads,reload:r.reload,melee:r.melee,grenade:r.grenade,bindings:r.bindings});
     r.net.input(input);r.net.predict(input);r.fireTap=false;r.jump=false;r.power=false;r.interact=false;r.inputWeapon=-1;r.reload=false;r.melee=false;r.grenade=false;
   }}
  const s=r.net.renderState(performance.now());
    if(s){if(!r.netViewReady){r.view.setMatch(r.net.viewMatch());r.view.lastEvent=r.lastAudio;r.view.setSpectator(r.net.spectate);r.view.setPlayerId(r.net.actorId??-1);r.netViewReady=true;}r.renderState=s;r.view.setSpectatorTarget(r.spectateTarget);if(r.recorder)r.recorder.frame(s,r.net.events);
    const me=(s.actors??[]).find((a:any)=>a.id===r.net.actorId)||(s.actors??[])[0];
    for(const e of r.net.events)if(e.id>r.lastAudio){audio.event(e,me);noteDamage(e,s,r.net.actorId);noteKill(e,r.net.actorId,s.time);if(r.display?.captions===true){const cap=audioCaption(e);if(cap){r.caption=cap.text;r.captionAt=s.time;}}if(e.type==='damage'&&e.actor===r.net.actorId)r.lastDamage=s.time;if(e.type==='damage'&&e.source===r.net.actorId&&e.actor!==r.net.actorId){r.lastHit=s.time;if(e.critical||e.headshot||Number(e.amount)>=48)r.lastCritical=s.time;}if((e.type==='pickup'||e.type==='powerup')&&e.actor===r.net.actorId){r.pickupText=e.type==='powerup'?`${e.kind.toUpperCase()} ACTIVE`:`${e.kind.toUpperCase()} ACQUIRED`;r.pickupAt=s.time;}if(isCocsMode(r.net?.state?.config?.mode)){const beat=cocsAnnouncement(e,{id:me?.id,team:me?.team??0});const next=acceptCocsAnnouncement(r.announceCue,r.announceAt,beat,s.time);if(next){r.announceCue=next.cue;r.announceAt=next.at;}}r.lastAudio=e.id;}
    studyOutcomes(r.net.events,'network');
    r.voice?.updateSpatial(s);audio.update(me,s.vehicles,elapsed);view.setInterpolation({enabled:false});r.perf?.time('render',()=>view.render(modeRef.current,s,elapsed,now/1000));r.perf?.frame(now);
     if(now-hudAt>80){setHud(decorate(s,{net:true,actorId:r.net.spectate?(r.spectateTarget??r.net.actorId):r.net.actorId,spectate:r.net.spectate,damage:s.time-r.lastDamage<.25,hit:s.time-r.lastHit<.12,critical:s.time-(r.lastCritical??-10)<.14,kill:s.time-(r.lastKill??-10)<.24,pickup:s.time-r.pickupAt<1.5?r.pickupText:'',fps:r.fps,renderer:view.renderer.isSoftware?'software':'webgl',pointerLocked:!!document.pointerLockElement,quality:connectionQuality(r.net)},now));hudAt=now;}
   }
   raf=requestAnimationFrame(loop);return;
  }
   else if(modeRef.current==='playing'&&r.spectateLocal&&r.match){r.acc=Math.min(r.acc+elapsed,RULES.dt*5);while(r.acc>=RULES.dt){r.match.step(RULES.dt,{inputs:{}});r.acc-=RULES.dt;r.view.capturePresentation?.(r.match);}r.applySpectateCamera(elapsed);if(now-hudAt>80){setHud(decorate(r.match.snapshot(),{actorId:r.spectateDirector?.targetId??0,spectate:true,spectateLocal:true,damage:false,hit:false,pickup:'',fps:r.fps,renderer:view.renderer.isSoftware?'software':'webgl',pointerLocked:!!document.pointerLockElement},now));hudAt=now;}}
   else if(modeRef.current==='playing'&&r.match){const lessonBreak=r.training&&(r.training.phase==='complete'||r.training.done);r.acc=lessonBreak?0:Math.min(r.acc+elapsed,RULES.dt*5);while(r.acc>=RULES.dt){const p=r.match.actors[0];const localInput:any=controlsFromState({keys,touch:r.touch,look:p,move:r.touch?{x:r.touch.moveX||0,y:r.touch.moveY||0}:null,sprint:r.touch?.sprint===true,crouch:r.touch?.crouch===true,mobility:r.touch?.mobility===true,fire:r.fire,fireTap:r.fireTap,jump:r.jump,power:r.power,interact:r.interact,weapon:r.inputWeapon,ads:r.ads,reload:r.reload,melee:r.melee,grenade:r.grenade,bindings:r.bindings});const cocsOrders=r.cocsOrders?.length?r.cocsOrders.splice(0,r.cocsOrders.length):null;const cocsSpends=r.cocsSpends?.length?r.cocsSpends.splice(0,r.cocsSpends.length):null;const cocsBuys=r.cocsBuys?.length?r.cocsBuys.splice(0,r.cocsBuys.length):null;r.match.step(RULES.dt,(cocsOrders||cocsSpends||cocsBuys)?{...localInput,cocs:{orders:cocsOrders??[],spends:cocsSpends??[],buys:cocsBuys??[]}}:localInput);applyTrainingGuard(r.match,r.training);r.fireTap=false;r.jump=false;r.power=false;r.interact=false;r.inputWeapon=-1;r.reload=false;r.melee=false;r.grenade=false;r.acc-=RULES.dt;r.view.capturePresentation(r.match);if(r.match.over){
    // A practice match stays unrecorded even after the tutorial is dismissed.
    // Keep identity separate from the optional HUD cursor for that reason.
    if(r.match===r.trainingMatch){r.recorder=null;r.training=null;r.trainingEvents=[];studyEmit('match_ended',{mode:String(r.match.config.mode),variant:'training'});setReward(null);setNotice('PRACTICE MATCH ENDED · Replay Field Training from Quick Start. Training does not award XP or update match records.');changeMode('selection');document.exitPointerLock?.();break;}
    if(r.recorder){const finished=r.recorder.finish({mapId:r.match.arena.id,mode:r.match.config.mode,player:r.match.actors[0]?.character});r.recorder=null;r.saveRecording?.(finished);}const result=r.match.snapshot(),actor=result.actors[0],mode=r.match.config.mode,win=actorWon(result,mode,actor),bestStreak=(r.match.events||[]).reduce((m:number,e:any)=>e?.type==='killstreak'?Math.max(m,Number(e.streak)||0):m,0),challenge=applyMatchAll(challengeRef.current,{win,actor,mode,team:isTeamMode(GAME_MODES.find((g:any)=>g.id===mode)),bestStreak});saveChallenges(challenge.state);const campaignStats=campaignProgressSummary(CAMPAIGN_MISSIONS as any,campaign);const award=awardMatch(profileRef.current,{win,actor,mode,bonusXp:challenge.gained,challengesCompleted:challenge.completed.length,campaignDone:campaignStats.done,campaignTotal:campaignStats.total});saveProgression(award.profile);{const modeInfo=GAME_MODES.find((g:any)=>g.id===mode),mapInfo=getMap(r.match.arena.id);saveMatchHistory({...result,win},actor,{mode,modeName:modeInfo?.name,mapId:r.match.arena.id,mapName:mapInfo?.name,duration:r.match.time,at:Date.now()});}if(mode==='campaign'){const wonCampaign=actorWon(result,'campaign',actor);setCampaign((p:any)=>wonCampaign?clearCheckpoint(recordMission(p,{id:r.match.config.mission,won:true,time:r.match.time,score:r.match.actors[0]?.frags||0})):recordMission(p,{id:r.match.config.mission,won:false}));}setReward(matchRewardSummary(award));if(award.unlocked.length)enqueueUnlocks(award.unlocked,award.gained);if(award.achievements?.length)enqueueAchievements(award.achievements);if(award.prestigeUp)setNotice(`PRESTIGE UP · ${award.profile.prestigeTier||'PRESTIGE'} ${award.profile.prestige}`);else if(award.levelUp)setNotice(`RANK UP · LEVEL ${award.profile.level} · ${rankTitle(award.profile.level)}`);else if(challenge.completed.length)setNotice(`CHALLENGE COMPLETE · ${challenge.completed.map((c:any)=>c.label).join(' · ')}`);studyEmit('match_ended',{mode:String(mode),win:win===true,source:'local'});changeMode('results');document.exitPointerLock?.();(audio?.sting?.(win?'victory':'defeat')||audio.tone(520,.4,'sine',.05,1000));break;}}view.syncActors?.(r.match);
   // Only build the (expensive) snapshot when a recorder keyframe is actually
  // due; event ingestion still runs every frame through the lightweight frame.
  // The match can clear itself the moment it ends (results transition, practice
  // end or error recovery). Capture it once and never re-read the live property:
  // doing so used to throw every frame and leave an error banner instead of the
  // results screen.
  const activeMatch=r.match;
  if(activeMatch&&r.recorder){const recordTime=activeMatch.time;if(r.recorder.due(recordTime))r.perf?.time('snapshot',()=>r.recorder.frame(activeMatch.snapshot(),activeMatch.events));else r.perf?.time('snapshot',()=>r.recorder.frame({time:recordTime},activeMatch.events));}
  for(const e of (activeMatch?.events??[]))if(e.id>r.lastAudio){audio.event(e,activeMatch.actors[0]);noteDamage(e,activeMatch,0);noteKill(e,0,activeMatch.time);if(r.display?.captions===true){const cap=audioCaption(e);if(cap){r.caption=cap.text;r.captionAt=activeMatch.time;}}if(e.type==='damage'&&e.actor===0)r.lastDamage=activeMatch.time;if(e.type==='damage'&&e.source===0&&e.actor!==0){r.lastHit=activeMatch.time;if(e.critical||e.headshot||Number(e.amount)>=48)r.lastCritical=activeMatch.time;}if((e.type==='pickup'||e.type==='powerup')&&e.actor===0){r.pickupText=e.type==='powerup'?`${e.kind.toUpperCase()} ACTIVE`:`${e.kind.toUpperCase()} ACQUIRED`;r.pickupAt=activeMatch.time;}if(e.type==='horde-resupply')r.singleNotice={type:e.type,text:`RESUPPLIED · WAVE ${e.wave??''}`.trim(),at:activeMatch.time};else if(e.type==='enemy-detonate')r.singleNotice={type:e.type,text:'SAPPER DETONATION',at:activeMatch.time};else if(e.type==='boss-phase'){r.singleNotice={type:e.type,text:`PHASE ${e.phase}${e.name?` · ${e.name}`:''}`,at:activeMatch.time};audio.announcerCue?.('boss');}else if(e.type==='mission-message')r.singleNotice={type:e.type,text:String(e.text??''),at:activeMatch.time};else if(e.type==='story-line'||e.type==='npc-bark')audio.announcerCue?.('objective');else if(e.type==='singleplayer-checkpoint'&&activeMatch.config.mode==='campaign'){setCampaign((p:any)=>setCheckpoint(p,e.missionId??activeMatch.config.mission,e.step));}if(isCocsMode(activeMatch.config.mode)){const beat=cocsAnnouncement(e,{id:0,team:activeMatch.actors[0]?.team??0});const next=acceptCocsAnnouncement(r.announceCue,r.announceAt,beat,activeMatch.time);if(next){r.announceCue=next.cue;r.announceAt=next.at;}}if(r.training){r.trainingEvents.push(e);if(r.trainingEvents.length>200)r.trainingEvents.splice(0,r.trainingEvents.length-200);}r.lastAudio=e.id;}}
  studyOutcomes(r.match?.events,'local');
    const cinematicMode=r.showcase&&(['selection','browse','lobby','progression','changelog'].includes(modeRef.current)||(modeRef.current==='theater'&&!r.demo));
    if(cinematicMode){const sc=r.showcase;const demoActive=demoOnlyRef.current;const plan=demoScenarioState(demoSessionRef.current,{elapsed:sc.time,limit:sc.seconds??SHOWCASE_MAX_SECONDS,over:sc.match.over===true,active:demoActive});if(r.showcaseMatchedId!==sc.mapId){view.setMatch(sc.match.snapshot());view.lastEvent=sc.match.serial;view.setPlayerId(-1);view.setDirector(sc.director);view.setCinema(true);r.showcaseMatchedId=sc.mapId;view.setShowcase(sc.match.snapshot());}if(!plan.paused){sc.acc=Math.min(sc.acc+elapsed,RULES.dt*4);let showcaseGuard=0;while(sc.acc>=RULES.dt&&showcaseGuard<4){sc.acc-=RULES.dt;showcaseGuard++;sc.match.step(RULES.dt,{inputs:{}});}sc.time+=elapsed;}
     // Rebuild only on a false->true pacing decision, so even a stale plan can
     // never rebuild the showcase twice for the same scenario end. A fresh build
     // drops camera ownership, so re-assert the session's style/follow after it.
     const planPrev=demoPlanRef.current,advanceNow=plan.advance&&!planPrev.advance,restartNow=plan.restart&&!planPrev.restart;
     demoPlanRef.current={advance:plan.advance,restart:plan.restart};
     if(advanceNow){if(buildShowcase())applyDemoCameraOwnership(demoSessionRef.current);else{sc.time=0;sc.acc=0;}}
     else if(restartNow){if(buildShowcase(r.showcaseSpec??undefined))applyDemoCameraOwnership(demoSessionRef.current);else{sc.time=0;sc.acc=0;}}
     else if(!plan.paused){const snap=sc.match.snapshot();snap.events=sc.match.events;snap.serial=sc.match.serial;view.setShowcase(snap);if(now-(r.broadcastAt||0)>250){r.broadcastAt=now;const modeInfo=GAME_MODES.find((m:any)=>m.id===sc.mode);setBroadcast({...demoBroadcast(snap,{modeName:modeInfo?.name,mapName:getMap(sc.mapId)?.name}),revision:r.showcaseIndex||0,subjects:(sc.match.actors||[]).filter((a:any)=>a&&a.id!==undefined&&a.id!==null).slice(0,4).map((a:any)=>({id:a.id,name:String(a.name||`BOT ${a.id}`)}))});}}if(enteredRef.current&&(modeRef.current==='selection'||modeRef.current==='progression')&&previewRef.current)view.setPreviewRect(previewRef.current.getBoundingClientRect());else view.setPreviewRect(null);
     // Free-roam flight: the dock owns the camera while the session says so, and
     // the inputs are cleared by Escape/blur/mode changes elsewhere. Re-assert the
     // free camera every frame so a scenario rebuild cannot silently drop it.
     const liveSession=demoSessionRef.current;
     if(demoOnlyRef.current&&liveSession.state==='free'){const freeCam=demoFreeAdapter(view);freeCam.set(true);freeCam.move(elapsed,demoFreeInput());}
    }
    else {view.setPreviewRect(null);if(['selection','browse','lobby','progression','changelog'].includes(modeRef.current)&&r.showcaseEnabled!==false&&!r.demo&&view.renderer?.isSoftware!==true&&now-(r.showcaseRetryAt||0)>3000){r.showcaseRetryAt=now;r.buildShowcase?.();}}
   if(r.demo&&modeRef.current==='theater'){const d=r.demo;if(!d.paused){d.time=Math.min(d.player.duration,d.time+elapsed*d.speed);if(d.time>=d.player.duration)d.paused=true;}const offset=d.player.keyframes?.[0]?.time||0,state=d.player.sample(d.time);state.events=d.player.eventsBetween(offset+(d.lastT||0),offset+d.time);d.lastT=d.time;d.state=state;view.setCinema(true);view.setDirector(d.director);view.setPlayerId(-1);if(now-d.hudAt>100){d.hudAt=now;setDemoTime(d.time);setDemoPaused(d.paused);}}
  if(!r.match&&r.net?.started&&r.net.state)r.voice?.updateSpatial(r.net.state);
  if(r.match&&r.match.actors[0])audio.update(r.match.actors[0],r.match.vehicles,elapsed,r.match.arena?.terrain?{surfaceAt:(x:number,z:number)=>terrainSupportAt(x,z,r.match.arena.terrain)?.material}:null);
  view.setShowcaseExpected?.(r.showcaseEnabled!==false&&!r.demo&&view.renderer?.isSoftware!==true&&['selection','browse','lobby','progression','changelog'].includes(modeRef.current));
  view.setInterpolation({enabled:modeRef.current==='playing'&&r.match!=null&&r.net?.started!==true&&!r.spectateLocal,alpha:RULES.dt>0?Math.max(0,Math.min(1,r.acc/RULES.dt)):1});
  r.perf?.time('render',()=>view.render(modeRef.current,selectRenderState(modeRef.current,{match:r.match,demoState:r.demo?.state,netState:r.renderState,netStarted:r.net?.started===true}),(['playing','selection','theater','progression','browse','lobby','changelog'].includes(modeRef.current))?elapsed:0,now/1000));r.perf?.frame(now);
  if(r.match&&!r.spectateLocal&&now-hudAt>80){const hudSnap=r.match.snapshot();if(r.training){const step=evaluateTraining(r.training,{snapshot:hudSnap,events:r.trainingEvents.splice(0),playerId:0,lattice:r.match.arena?.lattice??[]});r.training=step.training;if(step.completedNow){studyEmit('training_step_completed',{lesson:String(r.training.mode),index:Number(r.training.index)});r.announceCue={kind:'objective',team:r.match.actors[0]?.team??0,text:`STEP CLEAR · ${step.completedNow.title}`,detail:''};r.announceAt=r.match.time;}}setHud(decorate(hudSnap,{training:trainingView(r.training),damage:r.match.time-r.lastDamage<.25,hit:r.match.time-r.lastHit<.12,critical:r.match.time-(r.lastCritical??-10)<.14,kill:r.match.time-(r.lastKill??-10)<.24,pickup:r.match.time-r.pickupAt<1.5?r.pickupText:'',singleNotice:r.singleNotice&&r.match.time-r.singleNotice.at<4?r.singleNotice:null,fps:r.fps,renderer:view.renderer.isSoftware?'software':'webgl',pointerLocked:!!document.pointerLockElement},now));hudAt=now;}}catch(e:any){console.error('COCS frame failed',e);r.match=null;r.renderState=null;r.netViewReady=false;r.fire=r.fireTap=r.jump=r.power=r.interact=false;setHud(null);setError(`The arena renderer recovered from an error: ${String(e?.message||e)}. Try entering again.`);changeMode('selection');}raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);setReady(true);
   (window as any).tokenArenaSnapshot=()=>({mode:modeRef.current,fps:r.fps,renderer:view.renderer.isSoftware?'software':'webgl',drawCalls:view.renderer.info.render.calls,triangles:view.renderer.info.render.triangles,pointerLocked:document.pointerLockElement===canvas.current,input:{fire:r.fire,fireTap:r.fireTap,jump:r.jump,ads:r.ads,interact:r.interact,touch:{moveX:r.touch?.moveX??0,moveY:r.touch?.moveY??0,sprint:r.touch?.sprint===true,fire:r.touch?.fire===true,jump:r.touch?.jump===true}},net:r.net?.started===true,actorId:r.net?.actorId??0,camera:{x:view.camera.position.x,y:view.camera.position.y,z:view.camera.position.z,yaw:view.camera.rotation.y},...(r.match?.snapshot()??r.renderState??{}),showcase:r.showcase&&(['selection','browse','lobby'].includes(modeRef.current)||(modeRef.current==='theater'&&!r.demo))?r.showcase.match.snapshot():null,showcaseReady:!!view.showcaseState,showcaseExpected:view.showcaseExpected===true,showcaseModelFallback:view.showcaseExpected!==true&&!view.showcaseState,weather:view._weatherState?.().kind??null,weatherOverride:view._weatherOverride??null});
   (window as any).tokenArenaDebug={state:()=>{const sc=r.showcase;return sc?{time:sc.time,index:r.showcaseIndex,reel:Array.isArray(r.showcaseReel)?r.showcaseReel.length:r.showcaseReel,modeId:sc.modeId,mapId:sc.mapId,over:sc.match.over===true}:null;},skip:()=>{if(r.showcase)r.showcase.time=SHOWCASE_MAX_SECONDS+1;return !!r.showcase;},next:()=>r.buildShowcase?.(),delta:()=>({hits:r.net?.deltaHits??0,misses:r.net?.deltaMisses??0,base:r.net?.deltaApplied??0,rate:r.net?.bandwidth?.rate(performance.now())??0}),aim:(on:boolean)=>{if(!r?.view)return false;r.ads=on===true;r.view.setAim(on===true);return true;},weapon:(n:number)=>{const a=r?.match?.actors?.[0];if(!a)return null;a.weapon=n;a.ammo[n]=Infinity;return a.weapon;},fire:(on:boolean)=>{if(!r)return false;r.fire=on===true;r.fireTap=on===true;return true;},// Test-only: force the local co-op intermission window open/closed so UI
// automation can exercise the spend surface without clearing a wave. The
// wave clock still owns the real close; this only seeds the phase/ticks.
// Test-only: pause the render loop so browser automation can capture the
// HUD without wedging the software compositor. The loop keeps scheduling;
// only the 3D render step stops, and the canvas holds its last frame.
pauseRender:(on:boolean)=>{const previous=r.benchmarking===true;r.benchmarking=on===true;return previous;},spendWindow:(open:boolean,seconds=90)=>{const coop=r?.match?.objectiveState?.coop;if(!coop)return false;const dt=RULES.dt||1/60;if(open){coop.phase='intermission';coop.intermissionOpen=true;coop.intermissionTicks=Math.max(60,Math.round((Number(seconds)||90)/dt));}else{coop.intermissionOpen=false;coop.intermissionTicks=0;}return true;}};
    // Read-only attract-demo debug hook. It reconstructs the session/planner view
    // on demand (no new state, no per-frame React work) so automated checks can
    // sample the running shot without reaching into internal refs themselves.
    (window as any).tokenArenaDemo=()=>{
     const session=demoSessionRef.current,showcase=r.showcase,plan=showcase?.director?.plan??null;
     const subject=plan&&plan.primary!==null&&plan.primary!==undefined
      ?(showcase?.match?.actors??[]).find((a:any)=>a.id===plan.primary)??null
      :null;
     return {
      state:session?.state??null,
      cameraOwner:view.cameraOwner??null,
      rig:showcase?.director?.rig??null,
      subject:plan?{id:plan.primary??null,kind:plan.subjectKind??null,name:subject?String(subject.name??`BOT ${subject.id}`):null,alive:subject?subject.health>0:null}:null,
      reason:plan?.reason??null,
      transition:plan?.transition??null,
      visibility:plan?.visibility??null,
      score:plan?.score??null,
      incumbent:plan?.incumbent??null,
      startedAt:plan?.startedAt??null,
      minUntil:plan?.minUntil??null,
      matchTime:showcase?.match?.time??null,
      hudVisible:session?.hudVisible!==false,
      pinned:demoPinned(session),
      actualMap:showcase?.mapId??null,
      actualMode:showcase?.mode??null,
     };
    };
    (window as any).tokenArenaAudio=()=>runtime.current?.audio?.audioStatus?.()||null;
    (window as any).tokenArenaPerf=()=>{const render=view.getPerformance?.()||null;if(render&&Number.isFinite(render.gpuMs))r.perf?.setGpu?.(render.gpuMs);const cpu=r.perf?.snapshot?.()||null;return {cpu,render,report:r.perf?.report?.({drawCalls:render?.calls,triangles:render?.triangles,geometries:render?.geometries,textures:render?.textures,tier:render?.tier,gpu:render?.gpuMs??null,backend:render?.renderer?.backend})||''};};
    // Executable benchmark: applies the fixed preset scenario (map, seed, bots,
    // camera path), runs the direct and post-processed variants at 100% world
    // scale, warms up, measures a fixed window, then restores the previous
    // display and match. Returns a structured, copyable report.
    (window as any).tokenArenaBenchmark=(()=>{
     const frameStats=(times:number[])=>{const dels:number[]=[];for(let i=1;i<times.length;i++)dels.push(times[i]-times[i-1]);dels.sort((a,b)=>a-b);const pick=(p:number)=>dels.length?dels[Math.min(dels.length-1,Math.max(0,Math.round((dels.length-1)*p)))]:0;const median=pick(.5),p95=pick(.95);return {median,p95,frames:dels.length,fps:median>0?1000/median:0};};
     const run=async({durationMs=2500,warmupMs=700}={})=>{
      if(!r?.view)return {error:'no-view'};
      const target=r,savedDisplay={...target.display},savedFree=view.freeCam===true,savedFreePose={...view.freePose},hadMatch=!!target.match;
      target.benchmarking=true;
      const results=[];
      const makeBench=()=>{const cfg=normalizeConfig({...DEFAULT_CONFIG,mode:BENCHMARK_PRESET.mode,botCount:BENCHMARK_PRESET.botCount,difficulty:BENCHMARK_PRESET.difficulty});const map=resolveMapForMode(BENCHMARK_PRESET.mapId,cfg.mode,{legacy:target.legacyArenas});const loadout=resolveLoadout('chatgpt','openclaw');return new Match(loadout.character,loadout.harness,makeRng(BENCHMARK_PRESET.seed),map,{...cfg,seed:BENCHMARK_PRESET.seed,loadouts:{0:{character:loadout.character,harness:loadout.harness,gear:profileRef.current.gear,attachments:profileRef.current.attachments,finish:profileRef.current.finish}}});};
      try{
       for(const variant of BENCHMARK_PRESET.variants){
        const bench=makeBench();
        view.setMatch(bench);view.setPlayerId(-1);view.setFreeCam(true);
        view.setDisplay(benchmarkDisplay(variant));
        await new Promise<void>(resolve=>setTimeout(resolve,warmupMs));
        const times:number[]=[],path=BENCHMARK_PRESET.cameraPath,span=Math.max(1,BENCHMARK_PRESET.durationSeconds||20),start=performance.now();
        await new Promise<void>(resolve=>{let last=0;const step=(now:number)=>{times.push(now);const t=Math.min(span,(now-start)/1000);const segments=Math.max(1,path.length-1),f=t/span*segments,seg=Math.min(segments-1,Math.floor(f)),local=f-seg,a=path[seg],b=path[seg+1]||a;view.freePose={x:a.x+(b.x-a.x)*local,y:a.y+(b.y-a.y)*local,z:a.z+(b.z-a.z)*local,yaw:Math.atan2(a.x-b.x,a.z-b.z),pitch:0};bench.step(RULES.dt,{inputs:{}});try{view.render('playing',bench,Math.min(.05,(now-(last||now-16))/1000)||.016,now/1000);}catch{}last=now;if(now-start>=durationMs)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});
        const perf=view.getPerformance?.()||{};
        results.push({id:variant.id,stats:frameStats(times),calls:perf.calls,triangles:perf.triangles,passes:perf.passes,viewport:perf.viewport,tier:perf.tier,gpuMs:perf.gpuMs??null,backend:perf.renderer?.backend});
       }
      }finally{
       try{view.setFreeCam(savedFree);if(savedFree)view.freePose=savedFreePose;}catch{}
       if(hadMatch)try{view.setMatch(target.match);}catch{}
       else{target.showcaseMatchedId=null;}
       view.setDisplay(savedDisplay);setDisplay(savedDisplay);
       target.benchmarking=false;
      }
      const perf=view.getPerformance?.()||{};
      return {preset:BENCHMARK_PRESET,backend:perf.renderer?.backend||(view.renderer?.isSoftware?'software':'webgl'),renderer:perf.renderer,viewport:perf.viewport,results,report:benchmarkReport(results)};
     };
     return {preset:BENCHMARK_PRESET,report:benchmarkReport,run};
    })();
    }catch(e:any){setError(`The 3D renderer could not start: ${e.message}. Try a desktop browser with WebGL enabled.`);setReady(true);runtime.current=null;}})();
    const keydown=(e:KeyboardEvent)=>{const r=runtime.current;
     // Free-cursor toggle (default AltLeft): one remappable control that releases
     // the pointer in place — no pause, no menu — and toggles combat back on.
     const cursorBound=actionForCode(r?.bindings||bindings,e.code)==='cursor';
     if(cursorBound&&!e.repeat&&modeRef.current==='playing'&&!demoOnlyRef.current&&!chatOpenRef.current&&!isEditable(e.target)&&!isEditable(document.activeElement)){e.preventDefault();
      // F05: while dead the cursor key opens the explicit loadout queue instead
      // of the bare free cursor, so an unchanged kit never pauses combat.
      if(respawnEditorRef.current){setRespawnEditorOpen(false);return;}
      if(scoresInteractiveRef.current){setScoresInteractiveOpen(false);setScores(false);return;}
      if(respawnOpenRef.current){setRespawnEditorOpen(true);return;}
      toggleCursorMode();return;}
     // Spectator camera/roster keys are fixed page codes, not bindings: they
     // are advertised as RESERVED in the spectator controls help so a remap of
     // `command`/`melee`/etc. never reads as if it also moved these.
     if(r?.spectateLocal&&modeRef.current==='playing'&&!isEditable(e.target)&&!isEditable(document.activeElement)&&!chatOpenRef.current&&['KeyB','KeyF','KeyH','BracketLeft','BracketRight'].includes(e.code)){
      e.preventDefault();if(e.repeat)return;
      if(e.code==='KeyB')r.cameraMode=cycleCameraMode(r.cameraMode,1);
      else if(e.code==='KeyF'){const next=!(r.view?.freeCam);r.view?.setFreeCam(next);r.cameraMode=next?'free':'auto';}
      else if(e.code==='KeyH')setHideHud(v=>!v);
      else r.spectateDirector?.cycleTarget(r.match?.snapshot(),e.code==='BracketRight'?1:-1);
      r.applySpectateCamera?.(0);
      return;
     }
     if(r?.net?.spectate&&modeRef.current==='playing'&&!isEditable(e.target)&&!isEditable(document.activeElement)&&!chatOpenRef.current&&['KeyH','KeyP','BracketRight','BracketLeft'].includes(e.code)){
     e.preventDefault();if(e.repeat)return;
     if(e.code==='KeyH')setHideHud(v=>!v);
     else if(e.code==='KeyP')setThirdPerson(v=>{const next=!v;r.view.setSpectatorThird(next);return next;});
     else {const next=nextSpectateTarget(r.renderState?.actors,r.spectateTarget,e.code==='BracketRight'?1:-1);if(next!==null)r.spectateTarget=next;}
     return;
    }
    if(actionForCode(r?.bindings||bindings,e.code)==='voice'){if(!e.repeat&&!isEditable(e.target)&&syncVoice()){e.preventDefault();r?.voice?.setPushToTalk(true);}return;}if(!r||modeRef.current!=='playing'||chatOpenRef.current)return;
    // Native controls own their keys, but Tab must still stay inside the cursor
    // surface that owns the keyboard (the Spend target picker is a select).
    if(isEditable(e.target)||isEditable(document.activeElement)){
     if(e.code==='Tab'){const owner=cursorKeyboardOwner(cursorRef.current);if(owner&&cycleSurfaceFocus(owner,e.shiftKey))e.preventDefault();}
     return;
    }
    // O1c command board: hold the `command` binding to peek (release to fight),
    // arrows/Home/End move the listbox, Enter acts and Escape closes. It is
    // keyboard-only while the pointer is locked and never captures the pointer.
    const cocsBoardBound=actionForCode(r.bindings||bindings,e.code);
     const latticeMode=r.net?.started?r.renderState?.config?.mode:r.match?.config?.mode;
     const latticePlayer=isCocsMode(latticeMode)&&!r.net?.spectate&&!r.spectateLocal;
     if(latticePlayer&&!e.repeat&&cocsBoardBound==='command'){
      e.preventDefault();
      const control=cocsBoardControlRef.current,wasOpen=control?.isOpen()===true;
      // Press closed: open and remember the press. Press open: toggle closed.
      boardHoldRef.current={at:performance.now(),held:!wasOpen&&cocsBoardRef.current?.pinned!==true};
      if(wasOpen)control?.close();else control?.open(true);
      return;
     }
     if(latticePlayer&&!e.repeat&&cocsBoardControlRef.current?.isOpen()){
     // A focused control inside the board keeps its native Enter/Space
     // activation (PIN/CLOSE/EXPAND/ACT/RETRY/CHECK); the page shortcut only
     // drives the listbox when focus is on the canvas or the list itself.
     if((e.code==='Enter'||e.code==='Space')&&(e.target as HTMLElement)?.closest?.('.cocs-board button'))return;
     if(e.code==='ArrowDown'||e.code==='ArrowRight'){e.preventDefault();cocsBoardControlRef.current.move(1);return;}
     if(e.code==='ArrowUp'||e.code==='ArrowLeft'){e.preventDefault();cocsBoardControlRef.current.move(-1);return;}
     if(e.code==='Home'){e.preventDefault();cocsBoardControlRef.current.first();return;}
     if(e.code==='End'){e.preventDefault();cocsBoardControlRef.current.last();return;}
     if(e.code==='Enter'||e.code==='Space'){e.preventDefault();cocsBoardControlRef.current.activate();return;}
     if(e.code==='Escape'){e.preventDefault();cocsBoardControlRef.current.close();return;}
    }
     const orderKey=latticeOrderKey({mode:latticeMode,spectate:r.net?.spectate||r.spectateLocal,code:e.code,action:cocsBoardBound??'',armed:cocsControlRef.current?.armed(),repeat:e.repeat});
     if(orderKey){e.preventDefault();if(orderKey.type==='arm')cocsControlRef.current?.arm(orderKey.verb);else if(orderKey.type==='pick')cocsControlRef.current?.pickIndex(orderKey.index);else if(orderKey.type==='issue')cocsControlRef.current?.issue();else cocsControlRef.current?.cancel();return;}
     if((e.code==='KeyT'||e.code==='Enter')&&r.net?.started&&!cursorCombatKeysBlocked(cursorRef.current)){chatOpenRef.current=true;syncVoice();clearInput();setChatOpen(true);e.preventDefault();return;}
    if(e.code==='Escape'){
     // F05: an explicitly opened respawn editor or pinned standings closes on
     // Escape before the cursor machine routes the key anywhere else.
     if(respawnEditorRef.current||scoresInteractiveRef.current){e.preventDefault();if(respawnEditorRef.current)setRespawnEditorOpen(false);else{setScoresInteractiveOpen(false);setScores(false);}return;}
     const escaped=cursorEscape(cursorRef.current,{at:performance.now()});
     if(cursorActive(cursorRef.current)){
      e.preventDefault();
      // The same physical press that exited pointer lock is consumed; a
      // surface with its own Escape handler keeps the key; otherwise a
      // second press may pause locally (network matches cannot pause).
      if(escaped.effects.consumed||escaped.effects.blocked)return;
      if(escaped.effects.requestPause){if(r.net?.started)setPointerHint(true);else changeMode('paused');return;}
      return;
     }
     // Pointer still locked: the browser will release it and the lock
     // listener enters cursor mode. Do not pause on top of that exit.
     if(document.pointerLockElement===canvas.current||performance.now()-lockChangeAtRef.current<400)return;
     e.preventDefault();changeMode(r.net?.started?'lobby':'paused');return;
    }
    if(e.code==='Tab'){
     if(respawnEditorRef.current)return; // the editor traps its own Tab cycle
     const owner=cursorKeyboardOwner(cursorRef.current);
     if(owner===CURSOR_SURFACE.SCOREBOARD){e.preventDefault();setScoresInteractiveOpen(false);setScores(false);return;}
     if(owner&&cycleSurfaceFocus(owner,e.shiftKey)){e.preventDefault();return;} // scoped panels keep their own Tab cycle
     if(owner){e.preventDefault();return;} // the active surface owns its keys
     if(cursorActive(cursorRef.current)){e.preventDefault();setScores(true);setScoresInteractiveOpen(true);return;}
     e.preventDefault();setScores(true);return;
    }
    if(r.net?.spectate)return;
     // F05: one centralized priority check owns combat key routing — a spend
     // window, the respawn editor or the pinned standings must not re-seed held
     // movement/fire input. The board peek is the deliberate exemption.
     if(cursorCombatKeysBlocked(cursorRef.current))return;
     const bound=Object.values(r.bindings||bindings);if(bound.includes(e.code)||e.code==='KeyC'||e.code==='Tab')e.preventDefault();keys.add(e.code);
     const boundAction=actionForCode(r.bindings||bindings,e.code);if(!e.repeat){if(boundAction==='jump')r.jump=true;else if(boundAction==='power')r.power=true;else if(boundAction==='interact')r.interact=true;else if(boundAction==='reload')r.reload=true;else if(boundAction==='melee')r.melee=true;else if(boundAction==='grenade')r.grenade=true;}
    if(!e.repeat&&!cursorRef.current.surfaces.includes(CURSOR_SURFACE.SPEND)&&(/^Digit[1-9]$/.test(e.code)||e.code==='Digit0')){const n=e.code==='Digit0'?9:Number(e.code.slice(-1))-1;if(n>=WEAPONS.length)return;if(r.net?.started||(r.match&&hasAmmo(r.match.actors[0].ammo[n])))r.inputWeapon=n;}
   };
  const keyup=(e:KeyboardEvent)=>{const r=runtime.current;
   if(actionForCode(r?.bindings||bindings,e.code)==='command'&&cocsBoardRef.current?.pinned!==true){
    const hold=boardHoldRef.current;boardHoldRef.current={at:0,held:false};
    // Short tap = toggle open; held longer = peek that closes on release.
    if(hold.held&&performance.now()-hold.at>=BOARD_HOLD_MS)cocsBoardControlRef.current?.close();
   }if(actionForCode(r?.bindings||bindings,e.code)==='voice')r?.voice?.setPushToTalk(false);keys.delete(e.code);if(e.code==='Tab'&&!scoresInteractiveRef.current)setScores(false);};
  const move=(e:MouseEvent)=>{const r=runtime.current;if(demoOnlyRef.current&&demoSessionRef.current.state==='free'&&(document.pointerLockElement===canvas.current||r?.drag)){const d=r?.display||{},gain=(r?.lookSensitivity||1)*(d.adsSensitivity??1);demoFreeAdapter(r?.view).look(-e.movementX*.002*gain,-(d.invertY?-1:1)*e.movementY*.002*gain);return;}if(modeRef.current!=='playing'||chatOpenRef.current||r?.net?.spectate||!r?.match&&!r?.net?.started||(document.pointerLockElement!==canvas.current&&!r.drag))return;if(r.spectateLocal){const d=r.display||{},gain=r.lookSensitivity*((r.ads||r.touch?.ads)?(d.adsSensitivity??1):1),inv=d.invertY?-1:1;if(r.view?.freeCam)r.view.freeLook(-e.movementX*.002*gain,-inv*e.movementY*.002*gain);else r.spectateDirector?.look?.(-e.movementX*.002*gain,-inv*e.movementY*.002*gain);return;}const look=r.net?.started?r.look:r.match.actors[0],d=r.display||{},gain=r.lookSensitivity*((r.ads||r.touch?.ads)?(d.adsSensitivity??1):1);look.yaw-=e.movementX*.002*gain;look.pitch=Math.max(-1.45,Math.min(1.45,look.pitch-(d.invertY?-1:1)*e.movementY*.002*gain));};
  const down=(e:MouseEvent)=>{
   if(e.target!==canvas.current)return;
   const r=runtime.current;if(!r)return;
   // While the cursor is free the canvas never fires: a click is either the
   // one obvious way back to combat or an inert click outside a surface.
   if(cursorActive(cursorRef.current)){cursorResumeCombat();return;}
   if(demoOnlyRef.current&&demoSessionRef.current.state==='free'){canvas.current?.focus({preventScroll:true});if(document.pointerLockElement!==canvas.current)requestLock();return;}if(modeRef.current!=='playing'||chatOpenRef.current)return;if(r.net?.spectate)return;if(r.spectateLocal){canvas.current?.focus({preventScroll:true});if(document.pointerLockElement!==canvas.current)requestLock();return;}canvas.current?.focus({preventScroll:true});if(document.pointerLockElement!==canvas.current)requestLock();if(e.button===0){r.fire=true;r.fireTap=true;r.drag=true;}else if(e.button===2){e.preventDefault();r.ads=true;}};
 const up=(e:MouseEvent)=>{const r=runtime.current;if(!r)return;if(e.button===0||e.button===undefined){r.fire=false;r.drag=false;}else if(e.button===2)r.ads=false;};
 const contextmenu=(e:MouseEvent)=>{if(e.target===canvas.current&&modeRef.current==='playing')e.preventDefault();};
   const pause=()=>{voiceGate.current.blurred=true;syncVoice();clearInput();if(demoOnlyRef.current)clearDemoInputs();if(modeRef.current==='playing'){if(runtime.current?.net?.started){setPointerHint(!runtime.current.net.spectate);document.exitPointerLock?.();}else changeMode('paused');}};
  const lock=()=>{const r=runtime.current;if(!r)return;r.lockPending=false;lockChangeAtRef.current=performance.now();const locked=document.pointerLockElement===canvas.current;
   if(demoOnlyRef.current){if(locked){r.hadLock=true;canvas.current?.focus({preventScroll:true});setPointerHint(false);}else{r.hadLock=false;clearDemoInputs();}return;}
   if(locked){r.hadLock=true;canvas.current?.focus({preventScroll:true});setPointerHint(false);const gained=cursorLockGained(cursorRef.current);if(gained.changed)applyCursor(gained);return;}
   r.hadLock=false;
   // The browser released pointer lock (Escape, tab switch, element removal):
   // enter cursor mode instead of pausing. Our own surface exits land here
   // too but find the machine already in cursor mode and change nothing.
   if(modeRef.current==='playing'){const lost=cursorLockLost(cursorRef.current,{at:performance.now()});if(lost.changed)applyCursor(lost);}};
  const lockError=()=>{if(runtime.current)runtime.current.lockPending=false;if(modeRef.current==='playing'){setPointerHint(true);const lost=cursorLockLost(cursorRef.current,{at:performance.now()});if(lost.changed)applyCursor(lost);}};
  const wheel=(e:WheelEvent)=>{const r=runtime.current;if(cursorActive(cursorRef.current))return;if(modeRef.current!=='playing'||e.target!==canvas.current||blocksGameplay(chatOpenRef.current,r?.net?.spectate,e.target,document.activeElement)||(!r?.match&&!r?.net?.started)||e.deltaY===0)return;const p=r.net?.started?r.renderState?.actors?.find((a:any)=>a.id===r.net.actorId):r.match.actors[0];if(!p)return;e.preventDefault();const n=cycleWeapon(p.ammo,p.weapon,r.inputWeapon,e.deltaY);if(n>=0)r.inputWeapon=n;};
   const focus=(e:FocusEvent)=>{if(modeRef.current==='playing'&&isEditable(e.target))clearInput();syncVoice();};
   const focusOut=()=>{queueMicrotask(()=>{if(!cancelled)syncVoice();});};
   const windowFocus=()=>{voiceGate.current.blurred=false;syncVoice();};
   const visibility=()=>{if(document.hidden){clearInput();if(demoOnlyRef.current)clearDemoInputs();runtime.current?.voice?.setPushToTalk(false);}syncVoice();};
   window.addEventListener('focus',windowFocus);window.addEventListener('focusout',focusOut);document.addEventListener('visibilitychange',visibility);
  const pointerLost=()=>{if(runtime.current?.drag&&document.pointerLockElement!==canvas.current)clearInput();};
   window.addEventListener('focusin',focus);window.addEventListener('pointercancel',pointerLost);canvas.current?.addEventListener('pointerleave',pointerLost);
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('mousemove',move);window.addEventListener('mousedown',down);window.addEventListener('mouseup',up);window.addEventListener('contextmenu',contextmenu);window.addEventListener('blur',pause);document.addEventListener('pointerlockchange',lock);document.addEventListener('pointerlockerror',lockError);window.addEventListener('wheel',wheel,{passive:false});
    return()=>{cancelled=true;cancelAnimationFrame(raf);window.removeEventListener('focus',windowFocus);window.removeEventListener('focusout',focusOut);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focusin',focus);window.removeEventListener('pointercancel',pointerLost);canvas.current?.removeEventListener('pointerleave',pointerLost);window.removeEventListener('resize',resize);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('mousemove',move);window.removeEventListener('mousedown',down);window.removeEventListener('mouseup',up);window.removeEventListener('contextmenu',contextmenu);window.removeEventListener('blur',pause);document.removeEventListener('pointerlockchange',lock);document.removeEventListener('pointerlockerror',lockError);window.removeEventListener('wheel',wheel);view?.dispose();audio?.dispose();const r=runtime.current;runtime.current=null;r?.voice?.dispose();r?.net?.close();delete (window as any).tokenArenaSnapshot;delete (window as any).tokenArenaDemo;};
  },[]);
  useEffect(()=>{let saved;try{saved=JSON.parse(localStorage.getItem('token-arena-settings')||'{}').touch;}catch{}setTouchControls(typeof saved==='boolean'?saved:isTouchDevice());},[]);
 useEffect(()=>{const sync=()=>setFullscreen(Boolean((document as any).fullscreenElement||(document as any).webkitFullscreenElement));document.addEventListener('fullscreenchange',sync);document.addEventListener('webkitfullscreenchange',sync);return()=>{document.removeEventListener('fullscreenchange',sync);document.removeEventListener('webkitfullscreenchange',sync);};},[]);
  useEffect(()=>{runtime.current?.view.setCharacter(character);},[character,ready]);
 useEffect(()=>{if(runtime.current)runtime.current.display=display;runtime.current?.view.setDisplay(display);reducedOverride=display.reducedMotion===true;runtime.current?.view.director?.setReduced?.(reducedMotion());runtime.current?.audio?.setMothEnabled?.(!reducedMotion());},[display,ready]);
   useEffect(()=>{if(ready)try{localStorage.setItem('token-arena-customization',JSON.stringify({config,display,mapId}));}catch{}},[config,display,mapId,ready]);
   useEffect(()=>{const next=resolveMapForMode(mapId,config.mode,{legacy:legacyMaps});if(next!==mapId){setMapId(next);setNotice('Arena changed to match the selected mode.');}},[config.mode,mapId,legacyMaps]);
   useEffect(()=>{const r=runtime.current;if(!r||!ready)return;r.legacyArenas=legacyMaps;const key=`${legacyMaps}|${showcase}`;if(r.showcaseKey===key)return;const first=r.showcaseKey===undefined;r.showcaseKey=key;if(first&&r.showcase)return;if(showcase)r.buildShowcase?.();else{r.showcase=null;r.showcaseMatchedId=null;r.view.setShowcase(null);r.view.setCinema(false);r.view.setDirector(null);r.view.setPreviewRect(null);setShowcaseLive(false);}},[showcase,ready,legacyMaps]);
   useEffect(()=>{if(mode==='theater'&&!demoPlaying)runtime.current?.refreshDemos?.();},[mode,demoPlaying]);
   useEffect(()=>{if(!unlock)return;const timer=setTimeout(()=>setUnlockQueue(q=>q.slice(1)),4500);return()=>clearTimeout(timer);},[unlock]);
   useEffect(()=>{if(!achievement)return;const timer=setTimeout(()=>setAchievementQueue(q=>q.slice(1)),5200);return()=>clearTimeout(timer);},[achievement]);
   useEffect(()=>{if(mode!=='theater'||!demoPlaying)return;const onKey=(e:KeyboardEvent)=>{const r=runtime.current,d=r?.demo;if(!d)return;if(e.code==='Escape'){e.preventDefault();r.stopDemo?.();return;}if(e.code==='Space'){e.preventDefault();d.paused=!d.paused;d.hudAt=-1;setDemoPaused(d.paused);return;}if(e.code==='KeyR'){d.time=0;d.lastT=0;d.hudAt=-1;r.view.lastEvent=0;return;}if(e.code==='ArrowRight'){d.time=Math.min(d.player.duration,d.time+(e.shiftKey?10:5));d.lastT=d.time;d.hudAt=-1;r.view.lastEvent=0;return;}if(e.code==='ArrowLeft'){d.time=Math.max(0,d.time-(e.shiftKey?10:5));d.lastT=d.time;d.hudAt=-1;r.view.lastEvent=0;return;}if(e.code==='BracketRight'||e.code==='BracketLeft'){d.director.cycleTarget(d.state,e.code==='BracketRight'?1:-1);d.director.cut();return;}if(/^Digit[1-8]$/.test(e.code)){const rig=CAMERA_RIGS[Number(e.code.slice(-1))-1];if(rig){d.director.setRig(rig);d.director.cut();setDemoRig(rig);}}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[mode,demoPlaying]);
    useEffect(()=>{if(entered||demoOnly)return;const onKey=(e:KeyboardEvent)=>{if(e.metaKey||e.ctrlKey||e.altKey||isEditable(e.target)||/^F\d{1,2}$/.test(e.key))return;e.preventDefault();e.stopPropagation();enterMenu();};window.addEventListener('keydown',onKey,{capture:true});return()=>window.removeEventListener('keydown',onKey,{capture:true});},[entered,demoOnly]);
    // Back to Demo keyboard map. Every shortcut here has a visible dock button;
    // the important change from the old shell is that Space no longer exits
    // (free-roam flight uses it as vertical thrust) — Escape/Enter/Backspace and
    // the ENTER ARENA button leave the demo, and the first Escape while pointer
    // locked only releases the cursor.
    useEffect(()=>{if(!demoOnly)return;
     const onKey=(e:KeyboardEvent)=>{
      if(isEditable(e.target)||isEditable(document.activeElement))return;
      const session=demoSessionRef.current;
      if(session.state==='options'){if(e.code==='Escape'){e.preventDefault();closeDemoOptions();}return;}
      if(e.code==='Escape'){e.preventDefault();if(document.pointerLockElement){clearDemoInputs();document.exitPointerLock?.();return;}enterArenaFromDemo();return;}
      if(e.code==='Enter'||e.code==='Backspace'){const target=e.target instanceof HTMLElement?e.target:null;if(!target?.closest('button,a,input,select,textarea')){e.preventDefault();enterArenaFromDemo();}return;}
      if(e.code==='ArrowRight'){e.preventDefault();skipDemoScenario(1);}
      else if(e.code==='ArrowLeft'){e.preventDefault();skipDemoScenario(-1);}
      else if(e.code==='KeyH'){e.preventDefault();demoToggleHud();}
      else if(e.code==='KeyB'){e.preventDefault();demoCycleStyle(1);}
      else if(e.code==='KeyF'){e.preventDefault();demoToggleFree();}
      else if(e.code==='KeyR'){e.preventDefault();demoResetView();}
      else if(e.code==='KeyP'){e.preventDefault();demoTogglePause();}
      else if(e.code==='BracketRight'){e.preventDefault();demoFollow(1);}
      else if(e.code==='BracketLeft'){e.preventDefault();demoFollow(-1);}
      else if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)||Object.values(runtime.current?.bindings||bindings).includes(e.code)){e.preventDefault();runtime.current?.keys?.add(e.code);}
     };
     window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
    },[demoOnly]);
   // WP2.1: focus entry and exact-opener restoration are owned by the Modal
   // primitive, so closing a dialog never re-focuses an unrelated control and a
   // covered dialog never steals focus from the layer above it.
   const closeSetup=()=>{setSetupOpen(false);};
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const host=settings?settingsRef.current:onboarding!==null?onboardingRef.current:singleOpen?singleRef.current:setupOpen||mode==='paused'||mode==='results'?modalRef.current:null;if((onboarding!==null||settings||setupOpen||singleOpen||mode==='paused'||mode==='results')&&e.key==='Tab'&&host){const focusable=[...host.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex]:not([tabindex="-1"])')];if(focusable.length){const next=e.shiftKey?focusable[focusable.length-1]:focusable[0];if(e.shiftKey?document.activeElement===focusable[0]:document.activeElement===focusable[focusable.length-1]){e.preventDefault();next.focus();}}return;}if(e.key!=='Escape')return;if(settings){e.preventDefault();setSettings(false);return;}if(mode==='paused'){e.preventDefault();resumeRef.current();return;}if(singleOpen){e.preventDefault();setSingleOpen(false);return;}if(onboarding!==null){e.preventDefault();finishOnboarding();return;}if(setupOpen){e.preventDefault();closeSetup();return;}if(mode==='selection'&&enteredRef.current){e.preventDefault();exitToTitle();return;}if(mode==='browse'||mode==='progression'||mode==='changelog'){e.preventDefault();changeMode('selection');return;}if(mode==='theater'&&!demoPlaying){e.preventDefault();changeMode('selection');return;}if(mode==='lobby'){e.preventDefault();changeMode('selection');}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[setupOpen,singleOpen,onboarding,settings,mode,demoPlaying]);
  // Graphics lab hotkeys, live from every surface. A bare ` toggles the lab on
  // and off in place (the fast A/B during play); Shift+` opens the developer
  // drawer. Editable fields, chat and the command board keep their own keys.
  useEffect(()=>{
   const onKey=(e:KeyboardEvent)=>{
    if(e.code!==GRAPHICS_LAB_HOTKEY||e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;
    if(isEditable(e.target)||isEditable(document.activeElement)||chatOpenRef.current)return;
    if(cocsBoardControlRef.current?.isOpen())return;
    e.preventDefault();
    if(e.shiftKey){if(settings)setSettings(false);else openSettings('graphics-lab',canvas.current);return;}
    const lab=graphicsLabRef.current;if(!lab)return;
    if(lab.supported===false){showGraphicsNotice('Graphics lab needs WebGL');return;}
    const next={...lab.value,enabled:!lab.value.enabled};
    lab.update(next);
    showGraphicsNotice(describeGraphicsLab(next));
   };
   window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[settings]);
  const saveSettings=(s:number,m:boolean,show:boolean=showcase,legacy:boolean=legacyMaps)=>{setSensitivity(s);setMuted(m);setShowcase(show);setLegacyMaps(legacy);if(runtime.current){runtime.current.lookSensitivity=s;runtime.current.audio.setMuted(m);runtime.current.showcaseEnabled=show;runtime.current.legacyArenas=legacy;}try{const prefs=JSON.parse(localStorage.getItem('token-arena-settings')||'{}');localStorage.setItem('token-arena-settings',JSON.stringify({...prefs,sensitivity:s,muted:m,showcase:show,legacyArenas:legacy,touch:touchControls,voiceVolume:voicePrefs.current.volume,voiceThreshold:voicePrefs.current.threshold}));}catch{}};
  const requestLock=()=>{const r=runtime.current;if(!r||r.lockPending||document.pointerLockElement===canvas.current)return;canvas.current?.focus({preventScroll:true});const failed=()=>{r.lockPending=false;if(modeRef.current==='playing')setPointerHint(true);};if(!canvas.current?.requestPointerLock){failed();return;}r.lockPending=true;try{const result=canvas.current.requestPointerLock();result?.catch(failed);}catch{failed();}};
  requestLockRef.current=requestLock;
  // WP1.5: every round start clears the previous award for every role, so a
  // spectator (or a player entering the next round) can never read a stale
  // reward on the next results screen. Shared by the local and network starts.
  const resetRoundReward=()=>setReward(null);
   const createVoice=(n:any)=>{const r=runtime.current;if(!r||n!==r.net)return;disposeVoice();const voice:any=new VoiceChat({net:n});voice.onState=(state?:any)=>{if(state&&n===runtime.current?.net&&runtime.current?.voice===voice)setVoiceState(state);};r.voice=voice;r.voiceSuppressed=undefined;voice.setVolume(voicePrefs.current.volume);voice.setThreshold(voicePrefs.current.threshold);syncVoice();n.onVoiceSignal=(msg:any)=>{if(n===runtime.current?.net&&runtime.current?.voice===voice)voice.handleSignal(msg);};};
    const wireNet=(n:any)=>{const r=runtime.current,old=r.net;disposeVoice();resetChat();r.net=n;if(old&&old!==n)old.close();createVoice(n);n.onStart=()=>{if(n!==runtime.current?.net)return;resetRoundReward();syncNetInfo();
      // Round identity (WP0.3): a new authoritative round revision clears the
      // local strip/queues; a same-revision reconnect keeps them and reconciles
      // from the full snapshot delivered with this same `start` message.
      const roundRevision=Number.isInteger(n.roundRevision)?n.roundRevision:0;
      if(roundRevision!==r.cocsNetRound){r.cocsNetRound=roundRevision;r.cocsOrders=[];r.cocsSpends=[];r.cocsSpendSeq=0;r.cocsBuys=[];r.cocsBuySeq=0;r.cocsBuysPending=[];setCocsReqPending([]);const roundStrip=cocsStripState();r.cocsStrip=roundStrip;cocsStripRef.current=roundStrip;setCocsStrip(roundStrip);}
      r.match=null;r.renderState=null;r.netViewReady=false;r.lastAudio=0;r.spectateTarget=null;r.view.setSpectatorTarget(null);r.showcaseMatchedId=null;r.view.setShowcase(null);r.view.setCinema(false);r.view.setDirector(null);r.recorder=new DemoRecorder({state:r.net?.state||null,recordHz:18,meta:{net:true,mapId:r.net?.state?.mapId,mode:r.net?.state?.config?.mode}});r.lastDamage=r.lastHit=r.lastCritical=r.pickupAt=-10;r.damageNumbers=[];r.damageDir=null;r.damageDirAt=-10;r.prevScores=null;r.announceCue=null;r.announceAt=-10;r.killTimes=[];r.killCue=null;r.killCueAt=-10;r.acc=0;r.audio.start();r.audio.setModeTheme?.(r.net?.state?.config?.mode);setHud(null);studyMatchStart(String(r.net?.state?.config?.mode??'unknown'),'network');changeMode('playing');canvas.current?.focus({preventScroll:true});setPointerHint(!n.spectate&&document.pointerLockElement!==canvas.current);};
    n.onResults=(m:any)=>{if(n!==runtime.current?.net)return;syncNetInfo();if(r.recorder){const finished=r.recorder.finish({mapId:r.net?.state?.mapId,mode:r.net?.state?.config?.mode,net:true});r.recorder=null;r.saveRecording?.(finished);}document.exitPointerLock?.();{const mode:any=r.net?.state?.config?.mode,actor:any=(m.state.actors||[]).find((a:any)=>a.id===r.net?.actorId)||(m.state.actors||[])[0];if(mode&&actor){const won=actorWon(m.state,mode,actor),modeInfo:any=GAME_MODES.find((g:any)=>g.id===mode),mapId=r.net?.state?.mapId,mapInfo:any=mapId?getMap(mapId):null;saveMatchHistory({...m.state,win:won},actor,{mode,modeName:modeInfo?.name,mapId,mapName:mapInfo?.name,duration:m.state.time,at:Date.now()});r.audio?.sting?.(won?'victory':'defeat');}}setHud({...m.state,net:true,actorId:r.net?.actorId,spectate:r.net?.spectate,fps:r.fps,renderer:r.view.renderer.isSoftware?'software':'webgl',pointerLocked:false,damage:false,hit:false,pickup:''});studyEmit('match_ended',{mode:String(r.net?.state?.config?.mode??'unknown'),source:'network'});changeMode('results');};
   n.onClose=()=>{if(n!==runtime.current?.net)return;syncNetInfo();disposeVoice();resetChat();setNetPlayers([]);queuedRef.current=false;setNetQueued(null);setNetRanked(null);setNetError('Connection lost. Your seat is held briefly — reconnect to return.');changeMode('lobby');};
   n.onError=(m:any)=>{if(n!==runtime.current?.net)return;const message=String(m?.message||'');if(/ranked queue|matchmaking queue is full/i.test(message)){queuedRef.current=false;setNetQueued(null);}if(/room not found/i.test(message)){setNetError('That invite link points to a room that has closed. Browse open rooms or host a new one.');n.list();n.history();changeMode('browse');}else if(/room is full|spectator limit/i.test(message)){setNetError('That room is full right now. Browse open rooms or host a new one.');n.list();n.history();changeMode('browse');}else setNetError(message);syncNetInfo();};
   n.onProtocolMismatch=()=>{if(n!==runtime.current?.net)return;setUpdateReady(true);};
   // Authority-received actions always answer: a refusal (including rate-limit,
   // stale-round, id-reuse and dead/ended paths) surfaces once here instead of
   // leaving the optimistic card silently unresolved. A rejected REQ purchase
   // drops its pending row and names the reason next to the item.
   n.onCocsReject=(m:any)=>{const r=runtime.current;if(!r||n!==r.net)return;const reason=String(m?.reason??'refused').toUpperCase();const cardId=m?.cardId===null||m?.cardId===undefined?null:String(m.cardId),pending=r.cocsBuysPending,hit=cardId&&Array.isArray(pending)?pending.find((buy:any)=>String(buy?.cardId)===cardId):null;if(hit){const list=pending.filter((buy:any)=>buy!==hit);r.cocsBuysPending=list;setCocsReqPending(list);setCocsNotice({ok:false,text:`${hit.label} REJECTED · ${reqReasonCopy(m?.reason??'refused')}`,id:Date.now()});return;}setCocsNotice({ok:false,text:`ACTION REJECTED · ${reason}`,id:Date.now()});};
   n.onLobby=(m:any)=>{if(n!==runtime.current?.net)return;syncNetInfo();if(chatRoom.current!==m.roomId){resetChat();chatRoom.current=m.roomId;}r.voice?.updateLobby(m);syncVoice();setNetPlayers(m.players);setNetRoomId(m.roomId);setNetError('');setNetRanked(m.ranked??null);if(queuedRef.current&&m.ranked?.queue==='ranked'){queuedRef.current=false;setNetQueued(null);r.lastRoom={roomId:m.roomId,spectate:false};if(modeRef.current!=='lobby'&&modeRef.current!=='playing'&&modeRef.current!=='results')changeMode('lobby');}};
   n.onRooms=(m:any)=>{if(n===runtime.current?.net)setRooms(m.rooms);};
   n.onHistory=(m:any)=>{if(n===runtime.current?.net)setMatches(m.matches);};
    n.onChat=(m:any)=>{if(n===runtime.current?.net)setChatLog(prev=>[...prev.slice(-99),m]);};
    n.onProgression=(m:any)=>{if(n!==runtime.current?.net)return;const next=saveProgression(m.profile??m);if(m.unlocked?.length)enqueueUnlocks(m.unlocked,m.gained);if(m.achievements?.length)enqueueAchievements(m.achievements);if(m.prestigeUp)setNotice(`PRESTIGE UP · ${next.prestigeTier||'PRESTIGE'} ${next.prestige}`);else if(m.levelUp)setNotice(`RANK UP · LEVEL ${next.level} · ${rankTitle(next.level)}`);setReward(matchRewardSummary({...m,profile:next}));};};
   const connectNet=async()=>{const r=runtime.current;if(!r)return;if(r.net?.connected){disconnectNet();return;}
   const n=new NetClient(netUrl.trim()||DEFAULT_SERVER_URL);wireNet(n);
   try{await n.connect();if(n!==runtime.current?.net)return;n.join(config.playerName||selected.name,character,harness);changeMode('lobby');}catch(e:any){if(n===runtime.current?.net){disposeVoice();setNetError(String(e?.message||e));r.net=null;n.close();}}
  };
   const openBrowser=async()=>{const r=runtime.current;if(!r)return;setNetError('');const n=r.net&&r.net.connected?r.net:new NetClient(netUrl.trim()||DEFAULT_SERVER_URL);if(r.net!==n)wireNet(n);try{if(!n.connected)await n.connect();}catch(e:any){if(n===runtime.current?.net){disposeVoice();setNetError(String(e?.message||e));}return;}if(n!==runtime.current?.net)return;n.list();n.history();changeMode('browse');};
   const joinRoom=(roomId:string,spectate:boolean)=>{const r=runtime.current,n=r?.net;if(!r||!n?.connected)return;setNetError('');r.lastRoom={roomId,spectate:spectate===true};disposeVoice();resetChat();if(n.players.length>0)n.leave();createVoice(n);n.join(config.playerName||selected.name,character,harness,{roomId,spectate});changeMode('lobby');};
   const createRoom=()=>{const r=runtime.current,n=r?.net;if(!r||!n?.connected)return;setNetError('');disposeVoice();resetChat();if(n.players.length>0)n.leave();createVoice(n);n.create(roomName.trim()||'Custom',character,harness,config.playerName||selected.name);n.list();changeMode('lobby');};
   const quickJoin=async()=>{const r=runtime.current;if(!r)return;if(!r.net?.connected){const n=new NetClient(netUrl.trim()||DEFAULT_SERVER_URL);wireNet(n);try{await n.connect();if(n!==runtime.current?.net)return;}catch(e:any){if(n===runtime.current?.net){disposeVoice();setNetError(String(e?.message||e));}return;}}joinRoom('local',false);};
   // Ranked V2 entry point. The client sends its career id and progress token
   // over the existing `queue` message; the server verifies the token, ignores
   // any client rating and drafts from its own ladder. No new wire type: the
   // seat arrives through the existing welcome/lobby messages.
   const queueRanked=()=>{const r=runtime.current,n=r?.net;if(!r||!n?.connected)return;if(modeRef.current==='results')studyResultIntentRef.current='ranked-again';setNetError('');const name=config.playerName||selected.name;if(!n.players.length)n.join(name,character,harness,{roomId:'local'});n.send({type:'queue',ranked:true,name,playerId:n.playerId,progressToken:n.progressToken});queuedRef.current=true;setNetQueued({status:'queued'});};
   const cancelQueue=()=>{const n=runtime.current?.net;if(!n?.connected)return;n.send({type:'queue-leave'});queuedRef.current=false;setNetQueued(null);};
   // Invite links: ?room=CODE auto-connects and joins that room. Failures land
   // in the lobby error banner; a stale code falls back to the room browser.
   const joinInvite=async(roomId:string,spectate=false)=>{const r=runtime.current;if(!r||!roomId)return;setNetError('');r.lastRoom={roomId,spectate:spectate===true};disposeVoice();resetChat();const n=new NetClient(netUrl.trim()||DEFAULT_SERVER_URL);wireNet(n);try{await n.connect();if(n!==runtime.current?.net)return;createVoice(n);n.join(config.playerName||selected.name,character,harness,{roomId,spectate});changeMode('lobby');}catch(e:any){if(n===runtime.current?.net){disposeVoice();setNetError(`Could not join room ${roomId}: ${String(e?.message||e)}`);r.net=null;n.close();}}};
   useEffect(()=>{if(!ready||inviteHandled.current)return;const search=typeof window!=='undefined'?window.location.search:'';const room=roomFromLocation(search);if(!room)return;inviteHandled.current=true;joinInvite(room,spectateFromLocation(search));},[ready]);
   // Detect a newer deployed build. The document is no-cache, but a tab that has
   // been open across a deploy still runs old JS; this lets it offer a reload.
   useEffect(()=>{let cancelled=false;const check=async()=>{try{const res=await fetch('/api/version',{cache:'no-store'});if(!res.ok)return;const data:any=await res.json();if(!cancelled){const commit=typeof data?.commit==='string'&&data.commit?data.commit:'unknown';if(commit!=='unknown'){studyBuildRef.current=commit;const relabelled=setStudyLogBuild(studyLogRef.current,commit);if(relabelled!==studyLogRef.current)studyLogRef.current=relabelled;}}if(!cancelled&&typeof data?.version==='string'&&data.version&&data.version!==RELEASE_VERSION)setUpdateReady(true);}catch{}};check();const onFocus=()=>check();window.addEventListener('focus',onFocus);const timer=setInterval(check,300000);return()=>{cancelled=true;window.removeEventListener('focus',onFocus);clearInterval(timer);};},[]);
   const sendChat=()=>{const n=runtime.current?.net;if(!n?.connected||!chatDraft.trim())return;chatAtBottom.current=true;n.chat(chatDraft);setChatDraft('');(modeRef.current==='lobby'?lobbyInputRef:chatInputRef).current?.focus();};
  const reconnectNet=async()=>{const r=runtime.current,n=r?.net;if(!n)return;setNetError('');createVoice(n);try{await n.connect(n.url);if(n!==runtime.current?.net)return;n.join(config.playerName||selected.name,character,harness,r.lastRoom?{roomId:r.lastRoom.roomId,spectate:r.lastRoom.spectate===true}:{});}catch(e:any){if(n===runtime.current?.net){disposeVoice();setNetError(String(e?.message||e));}}};
  const resumeNet=()=>{const r=runtime.current;resetNetworkPresentation(r,r?.view);if(r)r.lastAudio=r.net?.events?.at(-1)?.id??0;changeMode('playing');r?.audio.start();if(!r?.net?.spectate)requestLock();};
  const disconnectNet=()=>{const r=runtime.current;if(!r?.net)return;disposeVoice();resetChat();const n=r.net;r.net=null;r.recorder=null;n.leave();n.close();setNetPlayers([]);setNetError('');changeMode('selection');};
  const hostAndStart=()=>{const r=runtime.current;if(!r?.net?.connected)return;r.audio.start();requestLock();r.net.host(config,mapId);r.net.start();};
      const startSpectate=()=>{const r=runtime.current;if(!r)return;disposeVoice();resetChat();resetRoundReward();try{setError('');if(r.net){const n=r.net;r.net=null;n.leave();n.close();setNetPlayers([]);}r.renderState=null;r.netViewReady=false;const startConfig=config,startMap=resolveMapForMode(mapId,startConfig.mode,{legacy:legacyMaps}),random=r.makeRng?r.makeRng():Math.random,{match}=buildSpectateMatch({character,harness,random,mapId:startMap,config:startConfig,humanCount:1}),director=new CinematicDirector({random:r.makeRng?r.makeRng():Math.random,center:match.center,radius:11,cutEvery:3.2,tour:false,structures:match.arena.structures});r.match=match;studyMatchStart(String(startConfig.mode),'spectate');r.warmScene?.(match.actors[0]?.weapon??0);r.spectateLocal=true;r.cameraMode='auto';r.spectateDirector=director;r.view.setPlayerId(-1);r.view.setSpectator(false);r.view.setShowcase(null);r.view.setCinema(true);r.view.setDirector(director);r.view.setDirectorLock(true);r.view.setFreeCam(false);r.view.setMatch(match);r.recorder=null;r.lastAudio=0;r.lastDamage=r.lastHit=r.lastCritical=r.lastKill=r.pickupAt=-10;r.damageNumbers=[];r.damageDir=null;r.damageDirAt=-10;r.prevScores=null;r.announceCue=null;r.announceAt=-10;r.killTimes=[];r.killCue=null;r.killCueAt=-10;r.acc=0;director.setAutoCut(true);r.audio.start();r.audio.setModeTheme?.(startConfig.mode);setHud({...match.snapshot(),spectate:true,spectateLocal:true});changeMode('playing');requestLock();}catch(e:any){console.error('COCS spectate failed',e);r.match=null;r.spectateLocal=false;r.spectateDirector=null;setHud(null);setError(`The spectate match could not start: ${String(e?.message||e)}. Try again.`);changeMode('selection');}};
      const start=(options?:{character:string;harness:string;mapId:string;config:any;training?:string})=>{const r=runtime.current;if(!r)return;if(modeRef.current==='results'){studyEmit('result_action_selected',{action:studyResultIntentRef.current||'rematch'});studyResultIntentRef.current=null;}disposeVoice();resetChat();resetRoundReward();try{setError('');if(r.net){const n=r.net;r.net=null;n.leave();n.close();setNetPlayers([]);}r.renderState=null;r.netViewReady=false;r.spectateLocal=false;r.spectateDirector=null;r.view.setDirectorLock?.(false);r.view.setFreeCam?.(false);r.cocsOrders=[];r.cocsSpends=[];r.cocsSpendSeq=0;r.cocsBuys=[];r.cocsBuySeq=0;r.cocsBuysPending=[];setCocsReqPending([]);const freshStrip=cocsStripState();r.cocsStrip=freshStrip;setCocsStrip(freshStrip);cocsStripRef.current=freshStrip;const loadout=resolveLoadout(options?.character??character,options?.harness??harness),startConfig=options?.config??config,startMap=resolveMapForMode(options?.mapId??mapId,startConfig.mode,{legacy:legacyMaps}),match=new Match(loadout.character,loadout.harness,Math.random,startMap,{...startConfig,loadouts:{0:{character:loadout.character,harness:loadout.harness,gear:profileRef.current.gear,attachments:profileRef.current.attachments,finish:profileRef.current.finish}}});r.view.setPlayerId(0);r.view.setSpectator(false);r.view.setMatch(match);r.view.setShowcase(null);r.view.setCinema(false);r.view.setDirector(null);r.showcaseMatchedId=null;r.match=match;r.training=(options?.training?createTraining(options.training,{start:match.actors[0]?{x:match.actors[0].x,z:match.actors[0].z}:null}):null) as any;r.trainingEvents=[];if(options?.training)studyEmit('training_step_shown',{lesson:String(options.training),index:0});if(match.objectiveState?.coop)match.objectiveState.coop.autoSpend=false;r.warmScene?.(match.actors[0]?.weapon??startConfig.startingWeapon??0);studyMatchStart(String(match.config.mode),'local',options?.training?'training':undefined);r.recorder=new DemoRecorder({state:match.snapshot(),recordHz:18,meta:{mapId:match.arena.id,mode:match.config.mode,player:loadout.character}});r.lastAudio=0;r.lastDamage=r.lastHit=r.lastCritical=r.lastKill=r.pickupAt=-10;r.damageNumbers=[];r.damageDir=null;r.damageDirAt=-10;r.prevScores=null;r.announceCue=null;r.announceAt=-10;r.killTimes=[];r.killCue=null;r.killCueAt=-10;r.singleNotice=null;r.audio.start();r.audio.setModeTheme?.(startConfig.mode);setHud(match.snapshot());changeMode('playing');requestLock();}catch(e:any){console.error('COCS arena start failed',e);r.match=null;r.renderState=null;r.netViewReady=false;setHud(null);setError(`The arena could not render: ${String(e?.message||e)}. Try entering again.`);changeMode('selection');}};
  // The checkpoint a campaign launch carries comes from launch intent, never
  // from the live config: NEXT MISSION and REPLAY start fresh, and only this
  // explicit resume path reads the step banked for the target mission.
  const startSinglePlayer=(sub:'horde'|'campaign'=singleSub,missionId?:string)=>{setSingleOpen(false);const target=missionId??singleMission,mission=missionFor(target);if(sub==='campaign'&&!mission)return;const rules=normalizeConfig({...config,mode:sub,botCount:0,mission:target,timeLimit:900,checkpoint:sub==='campaign'?campaignLaunchCheckpoint(campaign,target,'resume'):null});setConfig(rules);if(modeRef.current==='results')studyResultIntentRef.current='retry-mission';else studyEmit('match_intent_selected',{intent:String(sub)});if(sub==='campaign'&&mission)start({character,harness,mapId:mission.mapId,config:rules});else start({character,harness,mapId,config:rules});};
  // Mission select and replay need an explicit id because setState is async;
  // the button that clicked already knows which mission it wants. A launch from
  // mission select or the results NEXT MISSION action always opens at step 0.
  const startCampaignMission=(id:string)=>{setSingleOpen(false);const mission=missionFor(id);if(!mission)return;setSingleMission(id);const rules=normalizeConfig({...config,mode:'campaign',botCount:0,mission:id,timeLimit:900,checkpoint:campaignLaunchCheckpoint(campaign,id,'fresh')});setConfig(rules);start({character,harness,mapId:mission.mapId,config:rules});};
  // Horde upgrades and campaign checkpoints are owned by the single-player
  // module; the page only bridges the HUD action to the live match.
  const chooseHordeUpgrade=(id:string)=>{const r=runtime.current;if(!r?.match||!id)return;applyHordeUpgrade(r.match,String(id));};
  const resumeSingleplayer=()=>{const r=runtime.current;if(!r?.match)return;const checkpoint=r.match.modeState?.checkpoint??r.match.snapshot?.()?.singleplayer?.checkpoint;if(checkpoint===null||checkpoint===undefined)return;resumeSinglePlayer(r.match,checkpoint);};
  useEffect(()=>{const onUpgrade=(event:any)=>{const id=event?.detail?.id;if(id)chooseHordeUpgrade(id);};window.addEventListener('horde-upgrade-select',onUpgrade);return()=>window.removeEventListener('horde-upgrade-select',onUpgrade);},[]);
  // Quick start activities launch a match immediately with the current operator,
  // harness and rules, picking an arena that the chosen mode supports.
  const quickStart=(activity:string,overrides?:{botCount?:number;difficulty?:string})=>{const r=runtime.current;if(!r)return;const training=activity==='field-training'?'cocs':activity==='operations-training'?'cocs-coop':null;if(training){const pick='lattice-slice',rules=trainingConfig(training,{playerName:config.playerName});studyEmit('match_intent_selected',{intent:String(activity)});setConfig(rules);setMapId(pick);start({character,harness,mapId:pick,config:rules,training});r.trainingMatch=r.match;return;}if(activity==='spectate'){studyEmit('match_intent_selected',{intent:'spectate'});startSpectate();return;}if(activity==='horde'||activity==='campaign'){setSingleSub(activity);startSinglePlayer(activity);return;}studyEmit('match_intent_selected',{intent:String(activity),...(Number.isFinite(overrides?.botCount)?{count:Number(overrides!.botCount)}:{})});const allowed=mapsForMode(activity,{legacy:legacyMaps}),pick=allowed.some((m:any)=>m.id===mapId)?mapId:(allowed[0]?.id??mapId),rules=normalizeConfig({...config,mode:activity,...latticePracticeDefaults(activity),...(Number.isFinite(overrides?.botCount)?{botCount:overrides!.botCount}:{}),...(overrides?.difficulty?{difficulty:overrides.difficulty}:{})});setConfig(rules);setMapId(pick);start({character,harness,mapId:pick,config:rules});};
  const startTraining=(mode:string)=>quickStart(mode==='cocs-coop'?'operations-training':'field-training');
  const continueTutorial=()=>{const r=runtime.current;if(!r?.training)return;r.training=continueTraining(r.training,{time:r.match?.time??r.training.lastTime});r.trainingEvents=[];if(!r.training.done)studyEmit('training_step_shown',{lesson:String(r.training.mode),index:Number(r.training.index)});setHud((previous:any)=>previous?{...previous,training:trainingView(r.training)}:previous);canvas.current?.focus({preventScroll:true});};
  const endTutorial=(next?:string)=>{const r=runtime.current;if(!r?.training)return;r.training=skipTraining(r.training);studyEmit('training_step_skipped',{lesson:String(r.training.mode),index:Number(r.training.index)});r.training=null;r.trainingEvents=[];setHud((previous:any)=>previous?{...previous,training:null}:previous);if(next==='recommended'){const allowed=mapsForMode('deathmatch',{legacy:legacyMaps});const pick=allowed.some((m:any)=>m.id===mapId)?mapId:allowed[0]?.id??mapId;const rules=normalizeConfig({...DEFAULT_CONFIG,playerName:config.playerName});r.trainingMatch=null;setConfig(rules);setMapId(pick);start({character,harness,mapId:pick,config:rules});return;}canvas.current?.focus({preventScroll:true});if(next==='loadout'){r.trainingMatch=null;setNotice('LOADOUT · pick your operator and harness, then ENTER ARENA.');changeMode('selection');document.exitPointerLock?.();}};
  const shuffle=()=>{const selection=shuffleSelection(Math.random,{legacy:legacyMaps,mode:config.mode});setCharacter(selection.character);setHarness(selection.harness);setMapId(selection.mapId);setNotice('Loadout and arena shuffled. Match rules unchanged.');};
  const nextArena=()=>{const r=runtime.current;if(modeRef.current!=='results'||hud?.net||r?.net||!r?.match?.over)return;studyResultIntentRef.current='next-arena';const selection=nextArenaSelection(r.match.arena.id,Math.random,{legacy:legacyMaps,mode:config.mode});const rules=normalizeConfig(r.match.config);setMapId(selection.mapId);setConfig(rules);setNotice('Arena rotated. Operator and harness held.');start({character,harness,mapId:selection.mapId,config:rules});};
  const surpriseMe=()=>{if(modeRef.current==='results')studyResultIntentRef.current='surprise-me';const selection=surpriseSelection(Math.random,{legacy:legacyMaps});const rules=normalizeConfig({...config,mode:selection.mode});setCharacter(selection.character);setHarness(selection.harness);setMapId(selection.mapId);setConfig(rules);setNotice('');start({...selection,config:rules});};
 const resume=()=>{runtime.current?.audio.start();changeMode('playing');requestLock();};
 // WP2.1 Escape chain (Settings -> Pause -> game): the keydown listener is
 // registered once, so it calls the current resume through this ref. Resuming
 // is a real user gesture (the key press), so pointer-lock reacquisition stays
 // a consequence of that gesture and is never attempted from an effect.
 resumeRef.current=resume;
  const chooseCharacter=(id:string)=>{setCharacter(id);const valid=resolveLoadout(id,harness);if(valid.harness!==harness){setHarness(valid.harness);setNotice('Claude equipped Claude Code automatically.');}else setNotice('');};
  // Team-mode respawn switch (§3.7). Online goes through the validated server
  // message; a local match records the pending pair on the authoritative match.
  // Both land on the actor's next spawn — the overlay only appears while dead.
  const switchRespawnLoadout=(nextCharacter:string,nextHarness:string)=>{
   const loadout=resolveLoadout(nextCharacter,nextHarness);const r=runtime.current;
   if(!r)return {ok:false,reason:'NO MATCH RUNNING',character:loadout.character,harness:loadout.harness};
   // Hold the pick in the page state too so a reconnect re-seats the latest pair
   // (NetClient.join writes seatLoadout) instead of the selection-screen pair.
   if(character!==loadout.character)setCharacter(loadout.character);
   if(harness!==loadout.harness)setHarness(loadout.harness);
   if(r.net?.connected){r.net.loadout(loadout.character,loadout.harness);setRespawnQueue({character:loadout.character,harness:loadout.harness,status:'requested'});return {ok:true,pending:true,status:'requested',character:loadout.character,harness:loadout.harness};}
   const queued=Boolean(r.match?.setLoadout?.(r.view?.playerId??0,{character:loadout.character,harness:loadout.harness}));
   if(!queued)return {ok:false,reason:'LOADOUT UNCHANGED OR LOCKED',character:loadout.character,harness:loadout.harness};
   setRespawnQueue({character:loadout.character,harness:loadout.harness,status:'pending'});
   return {ok:true,pending:true,status:'pending',character:loadout.character,harness:loadout.harness};
  };
  const chooseGear=(slot:string,item:string)=>{const current=profileRef.current.gear||{},next={...current,[slot]:current[slot]===item?undefined:item};const saved=saveProgression({...profileRef.current,gear:next});runtime.current?.net?.gear(saved.gear,saved.attachments);setNotice('');};
  const chooseAttachment=(slot:string,item:string)=>{const current=profileRef.current.attachments||{},next={...current,[slot]:current[slot]===item?undefined:item};const saved=saveProgression({...profileRef.current,attachments:next});runtime.current?.net?.gear(saved.gear,saved.attachments);setNotice('');};
  const chooseFinish=(id:string)=>{const saved=saveProgression({...profileRef.current,finish:profileRef.current.finish===id?null:id});runtime.current?.net?.gear(saved.gear,saved.attachments,saved.finish);};
  const chooseCrosshair=(id:string)=>{saveProgression({...profileRef.current,crosshair:profileRef.current.crosshair===id?null:id});setDisplay((d:any)=>normalizeDisplay({...d,crosshair:id}));};
  const prefs=<><div className="preferences"><label htmlFor="sensitivity">Mouse sensitivity <span>{sensitivity.toFixed(1)}×</span></label><Slider id="sensitivity" aria-label="Mouse sensitivity" value={[sensitivity]} min={.3} max={2.5} step={.1} onValueChange={([v])=>saveSettings(v,muted)}/><div className="sound-setting"><label htmlFor="audio-switch">Game audio</label><Switch id="audio-switch" checked={!muted} onCheckedChange={v=>saveSettings(sensitivity,!v)}/></div><div className="sound-setting"><label htmlFor="showcase-switch">Menu showcase</label><Switch id="showcase-switch" checked={showcase} onCheckedChange={v=>saveSettings(sensitivity,muted,v)}/></div><div className="sound-setting"><label htmlFor="legacy-switch">Legacy arenas</label><Switch id="legacy-switch" checked={legacyMaps} onCheckedChange={v=>saveSettings(sensitivity,muted,showcase,v)}/></div><div className="sound-setting"><label htmlFor="touch-switch">Touch controls</label><Switch id="touch-switch" checked={touchControls} onCheckedChange={v=>setTouchPref(v)}/></div><div className="sound-setting"><label htmlFor="music-switch">Music</label><Switch id="music-switch" checked={demoMusic} onCheckedChange={v=>setMusicPref(v)}/></div><div className="audio-mix"><label htmlFor="music-volume">Music <span>{Math.round(musicVolume*100)}%</span></label><Slider id="music-volume" aria-label="Music volume" value={[musicVolume]} min={0} max={1} step={.05} onValueChange={([v])=>setAudioVolume('music',v)}/><label htmlFor="effects-volume">Effects <span>{Math.round(effectsVolume*100)}%</span></label><Slider id="effects-volume" aria-label="Effects volume" value={[effectsVolume]} min={0} max={1} step={.05} onValueChange={([v])=>setAudioVolume('effects',v)}/><label htmlFor="ambience-volume">Ambience <span>{Math.round(ambienceVolume*100)}%</span></label><Slider id="ambience-volume" aria-label="Ambience volume" value={[ambienceVolume]} min={0} max={1} step={.05} onValueChange={([v])=>setAudioVolume('ambience',v)}/><div className="audio-status"><button type="button" className="text-button" onClick={previewMusic}>Preview music</button>{audioNotice&&<small role="status">{audioNotice}</small>}</div></div></div><DisplayConfiguration display={display} onChange={(v:any)=>setDisplay(normalizeDisplay(v))}/><AccessibilityConfiguration accessibility={accessibility} onChange={(v:any)=>setAccessibility(normalizeAccessibility(v))}/><KeybindsConfiguration bindings={bindings} onChange={(v:any)=>setBindings(normalizeBindings(v))} conflicts={bindingConflicts(bindings)}/></>;
  // I6 — the pause modal shows a compact quick block instead of the full
  // settings form; the complete form stays in SettingsDialog behind one action.
  const pauseQuick=<div className="preferences pause-quick">
   <label htmlFor="pause-sensitivity">Mouse sensitivity <span>{sensitivity.toFixed(1)}×</span></label>
   <Slider id="pause-sensitivity" aria-label="Mouse sensitivity" value={[sensitivity]} min={.3} max={2.5} step={.1} onValueChange={([v])=>saveSettings(v,muted)}/>
   <div className="sound-setting"><label htmlFor="pause-audio">Game audio</label><Switch id="pause-audio" checked={!muted} onCheckedChange={v=>saveSettings(sensitivity,!v)}/></div>
  </div>;
  // I13 — captions / reduced motion become one-tap pills in the pause footer.
  const toggleCaptions=()=>setDisplay((d:any)=>normalizeDisplay({...d,captions:!(d.captions===true)}));
  const toggleReducedMotion=()=>setDisplay((d:any)=>normalizeDisplay({...d,reducedMotion:!(d.reducedMotion===true)}));
  const player=hud?.actors?.find((a:any)=>a.id===(hud.actorId??0))||hud?.actors?.[0],activePower=HARNESSES.find((h:any)=>h.id===player?.harness),hudMode=GAME_MODES.find((m:any)=>m.id===hud?.config?.mode),brief=commandBrief(hud,player,hudMode),hudMap=getMap(hud?.mapId||mapId),hudRoute=routeContext(hudMap,player),phase=matchPhase(hud);
   // --- LATTICE STRIKE V0b order strip ---------------------------------------
   // The pure state machine lives in `game/cocs-orders.mjs`; the page only owns
   // the current strip object, mirrors it into a ref so the global keydown can
   // drive it, and pushes issued orders onto the local match queue in
   // single-player or onto the authoritative wire in a networked match.
   cocsStripRef.current=cocsStrip;
   const applyCocsStrip=(next:any)=>{cocsStripRef.current=next;setCocsStrip(next);};
    const cocsNow=()=>cocsStripRef.current??cocsStripState();
    const cocsTeam=()=>player?.team===0||player?.team===1?Number(player.team):0;
    const latticeMap=isCocsMode(hudMode)?getMap(hud?.mapId??mapId):null;
    const latticeBoard=latticeBoardView(hud,player);
    for(const node of latticeBoard.nodes)node.label=latticeNodeLabel({id:node.id},latticeMap);
    // F04 integration: coach, strip and board all receive this exact model.
    // The model derives ground reachability from the live Match navigation graph
    // when local (or from the authored `navNodes` when networked), consumes
    // team-visible supply cuts, and resolves endgame so ARRAY anchors match the
    // authority's `capturableBy`; the sim still makes the final order decision.
    const latticeMatch=runtime.current?.match;
    const latticeModel=isCocsMode(hudMode)?latticeTargetModel(hud,latticeMap,player,{nav:latticeMatch?.nav,navEdges:latticeMatch?.edges,endgame:latticeMatch?.objectiveState?.endgame===true,cuts:latticeMatch?.objectiveState?.cuts}):null;
    // WP1.5 viewer parity: the offline order feed is filtered through the same
    // team policy the server applies to `net.events` (`cocsEventVisible`), so a
    // local player never sees enemy bot intent and local/network boards agree.
    // A spectator has no team and therefore sees no private order intent.
    const cocsViewerTeam=hud?.spectate===true?null:cocsTeam();
    const cocsOrderEvents=filterCocsEvents(((runtime.current?.net?.started?runtime.current?.net?.events:runtime.current?.match?.events)??[]).filter((event:any)=>['cocs-order','cocs-order-rejected','cocs-order-complete'].includes(String(event?.type))),cocsViewerTeam);
    const armCocsVerb=(id:string)=>applyCocsStrip(cocsArmVerb(cocsNow(),id));
     const pickCocsTarget=(target:any)=>{const nodes=cocsTargetableNodes(latticeBoard,cocsNow().armed,{model:latticeModel,map:latticeMap});applyCocsStrip(cocsPickTarget(cocsNow(),target,nodes));};
     const pickCocsIndex=(index:number)=>{const nodes=cocsTargetableNodes(latticeBoard,cocsNow().armed,{model:latticeModel,map:latticeMap});const node=nodes.find((entry:any)=>entry.index===index);if(node)pickCocsTarget(node.id);};
   const issueCocsOrder=()=>{const r=runtime.current,state=cocsNow(),snapshot=hud?.cocs,team=cocsTeam(),tick=Number(snapshot?.tick)||0,cardId=`cocs-${team}-${tick}-${Number(state.seq)||0}`,peerId=latticePeerId(r?.net,r?.match);
    const result=cocsIssueOrder(state,{tick,peerId,cardId,team,flux:snapshot?.flux?.[team]??0});
    if(!result.order){applyCocsStrip(result.state);return;}
    const gate=r?.match?.objectiveState?.coop?coopOrderGate(r.match,r.match.objectiveState,{verb:result.order.verb,peerId}):null;
    if(gate&&gate.ok!==true){studyEmit('order_rejected',{order:String(result.order.verb),source:'strip'},{journeyStage:'playing'});applyCocsStrip({...result.state,pending:null,issued:null,notice:`REJECTED · ${String(gate.reason).toUpperCase()}`});return;}
    applyCocsStrip(result.state);studyEmit('order_queued',{order:String(result.order.verb),source:'strip'},{journeyStage:'playing'});if(!r)return;
    if(r.net?.started&&!r.net.spectate){r.net.order(result.order.cardId,result.order.verb,result.order.target,'chief');return;}
    (r.cocsOrders??=[]).push(result.order);};
   const cancelCocsStrip=()=>applyCocsStrip(cocsClearStrip(cocsNow()));
   cocsControlRef.current={arm:armCocsVerb,pickIndex:pickCocsIndex,issue:issueCocsOrder,cancel:cancelCocsStrip,armed:()=>Boolean(cocsNow().armed)};
     const cocsView:any=isCocsMode(hudMode)?cocsCommandView(latticeBoard,hud?.cocs,player,cocsStrip,{interactKey:keyLabel(bindings.interact),model:latticeModel,map:latticeMap,orders:cocsOrderEvents}):null;
     if(cocsView){const coach=latticeCoach(hud,player,latticeMap,{model:latticeModel,previous:cocsCoachRef.current});cocsCoachRef.current=coach;cocsView.coach=coach;cocsView.keys=latticeKeys(bindings);}else cocsCoachRef.current=null;
   // O1c — the board is a client-side overlay. State (open/pinned/active) lives
   // here so the global keydown can drive hold-to-peek, pointer-locked listbox
   // navigation and the damage auto-collapse. The board is never opened outside
   // local cocs play and never steals pointer capture.
   // Local snapshots carry no orderLog/cards, so derive the rest of the board
   // from nodes/sinks/terminals/roles/orderStats and resolve every sink target
   // to a real node id (the sim rejects the literal 'node').
   const cocsSpendView=withSinkTargets(cocsView?.spend??null,hud?.cocs,player);
    const localCards=cocsView?.boardView?localBoardCards(latticeBoard,hud?.cocs,player,{spend:cocsSpendView,economy:cocsView.economy,model:latticeModel,map:latticeMap}):[];
   const mergedBoard=cocsView?.boardView?mergeLocalBoard(cocsView.boardView,localCards):cocsView?.boardView??null;
   const cocsBoardIds=mergedBoard?.listboxIds??[];
   const cocsBoardCards=mergedBoard?.cards??[];
   const boardCollapsed=Boolean(hud?.damage&&Number(hud?.time)-Number(hud?.damageDirAt)<2);
   cocsBoardRef.current={...cocsBoardRef.current,open:cocsBoard.open===true,pinned:cocsBoard.pinned===true,active:cocsBoard.active??0,ids:cocsBoardIds,cards:cocsBoardCards,count:cocsBoardIds.length,collapsed:boardCollapsed};
   const setBoard=(patch:any)=>{cocsBoardRef.current={...cocsBoardRef.current,...patch};setCocsBoard((s:any)=>({...s,...patch}));};
   const openCocsBoard=(open:boolean)=>setBoard({open:Boolean(open)||cocsBoardRef.current.pinned===true});
   const closeCocsBoard=()=>setBoard({open:false});
   const toggleCocsBoardPin=()=>setBoard({pinned:!cocsBoardRef.current.pinned,open:true});
   const moveCocsBoard=(delta:number)=>{const count=cocsBoardRef.current.count||0;if(!count)return;const next=(((cocsBoardRef.current.active??0)+delta)%count+count)%count;setBoard({active:next});};
   const selectCocsBoardCard=(id:any)=>{const index=(cocsBoardRef.current.ids??[]).indexOf(String(id));if(index>=0)setBoard({active:index});};
   // One dispatch for mouse clicks and the keyboard Enter path. Locally derived
   // cards queue through the same deterministic `(tick, peerId, cardId)` shape
   // as the order strip; gates are pre-flighted so a refusal is visible.
   // Dispatch only QUEUES: acceptance/completion/refusal arrive later from the
   // matching authoritative cardId result, never from this handler.
   const activateCocsBoardCard=(card:any,action:string)=>{
    const r=runtime.current;if(!r||!card)return {ok:false,reason:'NO MATCH'};
    const peerId=latticePeerId(r.net,r.match),verb=String(card.verb??'').toUpperCase(),tick=Number(hud?.cocs?.tick)||0,team=cocsTeam();
    const notify=(ok:boolean,text:string)=>setCocsNotice({ok,text,id:Date.now()});
    if(card.source===LOCAL_CARD_SOURCE.ORDER||action===LOCAL_CARD_ACTION.ISSUE){
     const target=card.target??null,cardId=`board-${team}-${tick}-${verb}-${target??'team'}`;
     const gate=r.match?.objectiveState?.coop&&!r.net?.started?coopOrderGate(r.match,r.match.objectiveState,{verb,peerId}):null;
     if(gate&&gate.ok!==true){studyEmit('order_rejected',{order:verb,source:'board'},{journeyStage:'playing'});notify(false,`${verb} REJECTED · ${String(gate.reason).toUpperCase()}`);return {ok:false,reason:String(gate.reason)};}
     if(r.net?.started&&!r.net.spectate)r.net.order(cardId,verb,target,'chief');else (r.cocsOrders??=[]).push({tick,peerId,cardId,team,verb,target});
     studyEmit('order_queued',{order:verb,source:'board'},{journeyStage:'playing'});
     notify(true,`${verb} ${card.targetLabel} · QUEUED`);return {ok:true,reason:null};
    }
    if(card.source===LOCAL_CARD_SOURCE.SPEND||action===LOCAL_CARD_ACTION.BUY){
     const result=spendCocs(card.verb,card.target);
     notify(result?.ok===true,result?.ok===true?`${verb} ${card.targetLabel??''} · QUEUED`:`${verb} REJECTED · ${result?.reason??'UNAVAILABLE'}`);
     return result;
    }
    if(r.net?.started&&!r.net.spectate){const cardId=`card-${card.id}-${action}`;if(['HACK','DEPLOY','SABOTAGE'].includes(verb)&&card.target!=null){r.net.terminal(card.target,verb==='SABOTAGE'?'cut':verb.toLowerCase(),{cardId});return {ok:true,reason:null};}if(verb==='VAULT'&&card.target!=null){r.net.terminal(card.target,'vault-store',{cardId});return {ok:true,reason:null};}if(['FORTIFY','REPAIR','RESUPPLY','REINFORCE'].includes(verb)){r.net.economy(verb.toLowerCase(),{cardId,target:card.target??null,role:verb==='REINFORCE'?'fighter':null});return {ok:true,reason:null};}}
    notify(action==='retry',`${action==='retry'?'RETRY':'CHECK'} · ${card.verb} ${card.targetLabel}${card.reason?` · ${card.reason}`:''}`);
    return {ok:true,reason:null};
   };
   // Returns {ok, reason} so the spend window and board can confirm or refuse
   // visibly. Local matches are pre-flighted against the authoritative gates;
   // online matches let the server decide and report through the snapshot log.
   const spendCocs=(verb:string,target:any)=>{
    const r=runtime.current,snapshot=hud?.cocs,tick=Number(snapshot?.tick)||0,team=cocsTeam(),seq=(Number(r?.cocsSpendSeq)||0)+1,peerId=latticePeerId(r?.net,r?.match);
    if(!r)return {ok:false,reason:'NO MATCH'};
    const verbId=String(verb).toUpperCase();
    if((verbId==='FORTIFY'||verbId==='REPAIR')&&(target===null||target===undefined||target==='node'||target==='hq'))return {ok:false,reason:'PICK A TARGET'};
    if(r.match?.objectiveState?.coop&&!(r.net?.started)){const gate=coopSpendGate(r.match,r.match.objectiveState,{verb:verbId,peerId});if(gate.ok!==true)return {ok:false,reason:String(gate.reason).toUpperCase()};}
    r.cocsSpendSeq=seq;studyEmit('spend_attempted',{verb:verbId,source:r.net?.started&&!r.net.spectate?'network':'local'},{journeyStage:'playing'});const cardId=`spend-${team}-${tick}-${seq}`;
    if(r.net?.started&&!r.net.spectate){r.net.economy(verbId.toLowerCase(),{cardId,target:target??null});return {ok:true,reason:null,cardId};}
    (r.cocsSpends??=[]).push({tick,peerId,cardId,team,verb:verbId,target:target??null});return {ok:true,reason:null,cardId};
   };
   // --- WP1.3 personal REQ purchases ----------------------------------------
   // One snapshot of the supported catalogue (`reqPurchaseOptions`) drives both
   // the rendered store and the pre-flight, so what is offered and what is
   // accepted agree. The Puma resolves its spend point here (the actor's nearest
   // friendly depot) and a live bought Puma disables the row before the click.
   const reqStore=(()=>{
    if(!isCocsMode(hudMode)||!hud?.cocs||!player)return null;
    const r=runtime.current;if(!r||r.spectateLocal||hud.spectate)return null;
    const team=cocsTeam(),actorId=player.id??0,snapshot=hud.cocs,coop=Boolean(snapshot.coop),mode=coop?'cocs-coop':'cocs';
    const live=r.net?.started!==true?r.match:null,liveState=live?.objectiveState?.kind==='cocs'?live.objectiveState:null,liveActor=live?.actors?.[Number(actorId)]??null;
    const row=(snapshot.req??[]).find((entry:any)=>String(entry?.id)===String(actorId));
    const base:any=reqPurchaseOptions({team,mode,actor:{id:actorId,req:Number(liveActor?.req??row?.req??0)||0,reqBuff:liveActor?.reqBuff??null},state:liveState??snapshot});
    const source=liveState??snapshot,depots=Object.values((source?.traversal?.depots)??{}) as any[],friendly=depots.filter((depot:any)=>depot&&depot.owner===team);
    const nearest=friendly.reduce((best:any,depot:any)=>{const distance=Math.hypot((Number(player.x)||0)-Number(depot.x||0),(Number(player.z)||0)-Number(depot.z||0));return !best||distance<best.distance?{distance,depot}:best;},null)?.depot??null;
    let items=base.items;
    if(nearest&&base.items.some((item:any)=>item.id==='puma'&&item.enabled)){
     const busy=liveState?(()=>{const depot=liveState.traversal?.depots?.[nearest.id]??nearest;return !depotPurchaseState(live,depot).available;})():Boolean(nearest.purchase&&(hud.vehicles??[]).some((vehicle:any)=>vehicle?.id===nearest.purchase.id&&Number(vehicle.health)>0));
     if(busy)items=base.items.map((item:any)=>item.id==='puma'?{...item,enabled:false,disabledReason:'vehicle'}:item);
    }
    return {...base,items,depotId:nearest?.id??null};
   })();
   // Dispatch only QUEUES/REQUESTS. The matching authoritative snapshot debit
   // (reqSpent, co-op buy log or `cocs-buy` event) is what confirms it; a
   // rejection removes the row and names the reason — never the click itself.
   const buyCocs=(itemId:string,options?:{depotId?:string})=>{
    const r=runtime.current,store=reqStore;
    if(!r||!store)return {ok:false,reason:'NO MATCH'};
    if(r.net?.spectate||r.spectateLocal)return {ok:false,reason:'SPECTATING'};
    if(player&&Number(player.health)<=0)return {ok:false,reason:'ELIMINATED'};
    const item=store.items.find((entry:any)=>entry.id===itemId);
    if(!item)return {ok:false,reason:'NOT AVAILABLE'};
    if(Array.isArray(r.cocsBuysPending)&&r.cocsBuysPending.some((buy:any)=>buy?.itemId===itemId))return {ok:false,reason:'QUEUED'};
    if(item.enabled!==true)return {ok:false,reason:reqReasonCopy(item.disabledReason)};
    const depotId=item.target==='depot'?(store.depotId??options?.depotId??null):null;
    if(item.target==='depot'&&!depotId)return {ok:false,reason:'NO FRIENDLY DEPOT'};
    const tick=Number(hud?.cocs?.tick)||0,team=cocsTeam(),seq=(Number(r.cocsBuySeq)||0)+1,peerId=latticePeerId(r.net,r.match),actorId=player?.id??0;
    r.cocsBuySeq=seq;const cardId=`buy-${team}-${tick}-${seq}`,row=(hud?.cocs?.req??[]).find((entry:any)=>String(entry?.id)===String(actorId));
    const pending:any={cardId,itemId,label:item.name,cost:Number(item.cost)||0,actorId,tick,baselineSpent:Number(row?.spent)||0,sinceEventId:Number(r.lastAudio)||0,status:'queued'};
    if(r.net?.started&&!r.net.spectate){pending.status='requested';r.net.buy(itemId,{...(depotId?{depotId}:{}),cardId});}
    else (r.cocsBuys??=[]).push({tick,peerId,cardId,team,actorId,itemId,...(depotId?{depotId}:{})});
    studyEmit('spend_attempted',{verb:'req',item:String(itemId),source:r.net?.started&&!r.net.spectate?'network':'local'},{journeyStage:'playing'});(r.cocsBuysPending??=[]).push(pending);setCocsReqPending([...r.cocsBuysPending]);
    setCocsNotice({ok:true,text:`${item.name} · ${item.cost} REQ · ${pending.status==='requested'?'REQUESTED':'QUEUED'}`,id:Date.now()});
    return {ok:true,reason:null,cardId};
   };
   if(runtime.current)cocsBoardControlRef.current={
     open:(open:boolean)=>openCocsBoard(open),
     close:()=>closeCocsBoard(),
     isOpen:()=>cocsBoardRef.current.open===true&&cocsBoardRef.current.collapsed!==true&&(cocsBoardRef.current.count||0)>0,
     move:(delta:number)=>moveCocsBoard(delta),
     first:()=>setBoard({active:0}),
     last:()=>setBoard({active:Math.max(0,(cocsBoardRef.current.count||1)-1)}),
     activate:()=>{const id=cocsBoardRef.current.ids?.[cocsBoardRef.current.active??0];const card=(cocsBoardRef.current.cards??[]).find((entry:any)=>entry.id===id);if(card)activateCocsBoardCard(card,card.action??(card.status==='blocked'?'retry':'check'));},
   };
       // The spend window is snapshot-driven; SKIP only dismisses this window
    // locally (the deterministic sim still closes it on its own clock). The
    // `windows` counter identifies the current window so a new one re-opens.
    const spendOpen=Boolean(hud?.cocs?.director?.intermission?.open)&&isCocsMode(hud?.config?.mode);
    const spendWindow=Number(hud?.cocs?.director?.intermission?.windows)||0;
    const spendVisible=spendOpen&&spendDismissed!==spendWindow;
    const skipSpend=()=>{if(spendOpen)setSpendDismissed(spendWindow);};
    const reopenSpend=()=>setSpendDismissed(null);
const cocsCommand=cocsView?{...cocsView,boardView:mergedBoard??cocsView.boardView,spend:cocsSpendView??cocsView.spend,armCocsVerb,pickCocsTarget,issueCocsOrder,cancelCocsStrip,spendCocs,spendVisible,skipSpend,reopenSpend,notice:cocsNotice,req:reqStore,onBuyReq:buyCocs,reqPending:cocsReqPending,onReadoutPanel:toggleReadoutPanel,cursorKey:keyLabel(bindings.cursor??DEFAULT_BINDINGS.cursor),commandKey:latticeKeys(bindings).command,commandShortcut:bindingShortcut(bindings.command??DEFAULT_BINDINGS.command),selectBoardCard:selectCocsBoardCard,activateBoardCard:activateCocsBoardCard,closeBoard:closeCocsBoard,toggleBoardPin:toggleCocsBoardPin,boardOpen:cocsBoard.open===true&&!boardCollapsed,boardCollapsed,boardPinned:cocsBoard.pinned===true,boardActive:cocsBoardIds[cocsBoard.active??0]??cocsBoardIds[0]??null}:null;
    // WP1.1: an explicit COCS surface (open command board, visible spend
    // window) or the paused Training completion beat owns the cursor. While one
    // is up the touch layer is suspended so move/look/fire capture cannot run
    // behind the surface.
    const touchSuspended=Boolean(spendVisible||(cocsBoard.open===true&&!boardCollapsed)||hud?.training?.phase==='complete'||hud?.training?.done===true);
   const aimActor=player||hud?.actors?.[0],aimWeapon=aimActor?WEAPONS[aimActor.weapon??0]||WEAPONS[0]:null,aimSpread=aimActor?effectiveSpread(aimActor,aimWeapon,{handling:harnessWeaponHandling(aimActor.harness,aimActor.weapon)}):0,crosshairGap=dynamicCrosshairGap(aimSpread,display.size),reloadFill=reloadProgress(aimActor),reloading=Boolean(aimActor?.reloading),posture=postureLabel(aimActor),marker=hitMarker(hud,player),ammoEmpty=Boolean(player&&typeof player.ammo?.[player.weapon]==='number'&&player.ammo[player.weapon]===0),ammoLow=lowAmmo(player,WEAPONS);
    const killNotice=killBanner(hud,player),suddenBanner=suddenDeathBanner(hud),startBanner=matchStartBanner(hud,undefined,hudMode),scoreCue=hud?.scoreCue??null,damageIndicator=hud?.damageDir&&hud.time-hud.damageDirAt<.8?hud.damageDir:null,awards=matchAwards(hud),radar=radarContacts(hud,player),radarCols=radarPaletteFor(accessibility.palette);
    const respawn=respawnOverlayView(hud,player);respawnOpenRef.current=respawn.open===true;
    // --- Cursor surfaces ----------------------------------------------------
    // Every interactive overlay registers here. The first one releases the
    // pointer and clears combat inputs; the last one to close asks for combat
    // back. The effects only run on a real transition, so a surface opening
    // while the cursor is already free does not unlock twice.
    useEffect(()=>{if(!cocsNotice)return;const timer=setTimeout(()=>setCocsNotice(null),4200);return()=>clearTimeout(timer);},[cocsNotice?.id]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.SPEND,spendVisible);},[spendVisible]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.BOARD,cocsBoard.open===true&&!boardCollapsed);},[cocsBoard.open,boardCollapsed]);
    // F05: the Tab glance is passive and never registers here; only the
    // explicitly pinned standings surface releases the pointer.
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.SCOREBOARD,scoresInteractive);},[scoresInteractive]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.SETTINGS,settings);},[settings]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.PAUSE,mode==='paused');},[mode]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.RESULTS,mode==='results');},[mode]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.DEMO,demoSession.state==='options');},[demoSession.state]);
    // F05: the automatic death summary is passive. The RESPAWN surface only
    // registers for the explicitly opened editor, and it is torn down when the
    // respawn ends so a later death starts from the same passive state.
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.RESPAWN,respawn.open===true&&respawnEditor);},[respawn.open,respawnEditor]);
    useEffect(()=>{if(!respawn.open){if(respawnEditorRef.current)setRespawnEditorOpen(false);if(respawnQueue)setRespawnQueue(null);}},[respawn.open,respawnQueue]);
    // WP3.2: death and respawn are participant transitions of the live HUD
    // actor. One guarded effect covers local and network play alike, and it
    // never follows a spectated actor.
    useEffect(()=>{
     if(hud?.spectate===true)return;
     const actor=hud?.actors?.find((a:any)=>a.id===(hud?.actorId??0))||hud?.actors?.[0];
     if(!actor||!hud?.config?.mode)return;
     const dead=Number(actor.health)<=0;
     if(dead&&!studyDeadRef.current){studyDeadRef.current=true;studyEmit('death',{mode:String(hud.config.mode)},{journeyStage:'playing'});}
     else if(!dead&&studyDeadRef.current){studyDeadRef.current=false;studyEmit('respawn',{mode:String(hud.config.mode)},{journeyStage:'playing'});}
    },[hud]);
    useEffect(()=>{syncCursorSurface(CURSOR_SURFACE.TRAINING,mode==='playing'&&(hud?.training?.phase==='complete'||hud?.training?.done===true));},[mode,hud?.training?.phase,hud?.training?.done]);
    // A new spend window clears a previous SKIP and announces itself once: a
    // HUD caption (when captions are on) plus the objective announcer motif.
    useEffect(()=>{
     if(!spendOpen){setSpendDismissed(null);return;}
     studyEmit('spend_opened',{window:spendWindow},{journeyStage:'playing'});
     const r=runtime.current;if(!r)return;
     r.caption='INTERMISSION · SPEND WINDOW OPEN · SPEND FLUX OR SKIP';
     r.captionAt=Number(hud?.time)||0;
     r.audio?.announcerCue?.('objective');
    },[spendOpen,spendWindow]);
    // WP1.3: a queued/requested purchase only becomes CONFIRMED when the
    // authoritative snapshot shows the debit (reqSpent delta, co-op buy log or
    // `cocs-buy` event); a server reject or a grace-expired row becomes a named
    // REJECTED notice. The click itself never claims success.
    useEffect(()=>{
     const r=runtime.current,pending=r?.cocsBuysPending;
     if(!r||!Array.isArray(pending)||!pending.length)return;
     const cocs=hud?.cocs,rows=Array.isArray(cocs?.req)?cocs.req:[],actorId=player?.id??0,row=rows.find((entry:any)=>String(entry?.id)===String(actorId));
     const events=[...(r.match?.events??[]),...(r.net?.events??[])];
     const result=reconcileReqBuys(pending,{actorId,spent:row?Number(row.spent)||0:undefined,tick:Number(cocs?.tick)||0,buys:Array.isArray(cocs?.buys)?cocs.buys:[],events,reasonFor:(buy:any)=>{
      if(player&&Number(player.health)<=0)return 'eliminated';
      return ((reqStore?.items as any[])?.find((entry:any)=>entry.id===buy.itemId))?.disabledReason??null;
     }});
     if(!result.confirmed.length&&!result.refused.length)return;
     r.cocsBuysPending=result.remaining;setCocsReqPending(result.remaining);
     const refused=result.refused[result.refused.length-1],confirmed=result.confirmed[result.confirmed.length-1];
     if(refused)studyEmit('spend_resolved',{verb:'req',outcome:'rejected',source:r.net?.started?'network':'local'},{journeyStage:'playing'});
     if(refused)setCocsNotice({ok:false,text:`${refused.label} REJECTED · ${reqReasonCopy(refused.reason)}`,id:Date.now()});
     else if(confirmed)setCocsNotice({ok:true,text:`${confirmed.label} · CONFIRMED · ${confirmed.cost} REQ`,id:Date.now()});
    },[hud]);

   const {vehicle,prompt:vehiclePrompt}=vehicleHud(player,hud?.vehicles,hud?.flags,hud?.spectate,bindings);
   const scoreboard=renderScoreboard(hud);
   // Demo dock/options view data. The session is plain state mirrored from
   // game/demo-session.mjs; the broadcast digest carries the actual running
   // scenario and the subject labels shown on the demo HUD.
   const demoRunning=broadcast?{modeName:broadcast.modeName,mapName:broadcast.mapName,phase:broadcast.phase,clock:broadcast.clock}:null;
   const demoActual={mode:runtime.current?.showcase?.mode??null,modeName:broadcast?.modeName??null,mapId:runtime.current?.showcase?.mapId??null,mapName:broadcast?.mapName??null};
   const demoLabels=demoRunningLabels(demoSession,{actual:demoRunning,subjects:broadcast?.subjects??null});
   const isRace=hud?.config?.mode==='puma-race',isSoccer=hud?.config?.mode==='puma-soccer',armsrace=hud?.config?.mode==='armsrace',race=raceDisplay(hud,player?.id),soccerState=hud?.race,soccerRow=soccerState?.standings?.find((row:any)=>row.actorId===player?.id),soccer=isSoccer?soccerDisplay(hud,player?.id):null,isSingle=hud?.config?.mode==='horde'||hud?.config?.mode==='campaign',single=isSingle?singlePlayerDisplay(hud):null,campaignNext=isSingle?nextMissionId(campaign):null;
   const raceControls=`${moveKeys} throttle / steer / ${keyLabel(bindings.jump)} or ${keyLabel(bindings.crouch)} brake / ${keyLabel(bindings.sprint)} boost / Click or ${keyLabel(bindings.power)} item / ${keyLabel(bindings.interact)} reset`;
   const soccerControls=`${moveKeys} throttle / steer / ${keyLabel(bindings.jump)} or ${keyLabel(bindings.crouch)} brake / ${keyLabel(bindings.sprint)} boost / ${keyLabel(bindings.interact)} reset`;
    const soccerTeam=Number.isFinite(soccerRow?.team)?soccerRow.team:Number.isFinite(soccer?.team)?soccer?.team:null,soccerGoals=Number(soccerRow?.goals)||0;
   const enableVoice=async()=>{const r=runtime.current,n=r?.net,voice=r?.voice;if(!voice||!n?.connected)return;syncVoice();try{await voice.enable(voiceState.mode);if(n===runtime.current?.net&&voice===runtime.current?.voice)syncVoice();}catch(e:any){if(n===runtime.current?.net&&voice===runtime.current?.voice)setVoiceState((s:any)=>({...s,error:String(e?.message||e)}));}};
   const voicePanel=<section className={`voice-panel ${voiceState.talking?'talking':''}`} aria-label="Room voice chat"><div className="voice-heading"><strong>VOICE</strong><span role="status">{voiceState.status==='requesting'?'MIC REQUEST PENDING':voiceState.talking?'TRANSMITTING':voiceState.enabled?voiceState.status:'MIC OFF'}</span></div><div className="voice-actions"><button onClick={voiceState.enabled||voiceState.status==='requesting'?()=>runtime.current?.voice?.disable():enableVoice} disabled={!runtime.current?.net?.connected||!!runtime.current?.net?.spectate}>{voiceState.status==='requesting'?'Cancel mic request':voiceState.enabled?'Disable mic':'Enable voice'}</button><label>Mode<select aria-label="Voice mode" value={voiceState.mode} onChange={e=>{runtime.current?.voice?.setPushToTalk(false);runtime.current?.voice?.setMode(e.target.value);setVoiceState((s:any)=>({...s,mode:e.target.value}));}}><option value="ptt">PTT (hold {voiceKey})</option><option value="auto">VAD (auto talk)</option></select></label>{voiceState.mode==='ptt'&&<button className="voice-hold" aria-label={`Hold to talk, or hold ${voiceKey}`} aria-pressed={!!voiceState.talking} disabled={!voiceState.enabled||!!runtime.current?.net?.spectate} onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.focus();if(syncVoice()){e.currentTarget.setPointerCapture(e.pointerId);runtime.current?.voice?.setPushToTalk(true);}}} onPointerUp={()=>runtime.current?.voice?.setPushToTalk(false)} onPointerCancel={()=>runtime.current?.voice?.setPushToTalk(false)} onLostPointerCapture={()=>runtime.current?.voice?.setPushToTalk(false)}>Hold to talk / {voiceKey}</button>}</div>{voiceState.error&&<p role="alert" className="voice-error">{String(voiceState.error)}</p>}<details><summary>Voice settings & privacy</summary><label>Received voice volume <output>{Math.round(voiceVolume*100)}%</output><input aria-label="Received voice volume" type="range" min="0" max="1" step=".01" value={voiceVolume} onChange={e=>{const v=Number(e.target.value);setVoiceVolume(v);setVoicePref({volume:v});runtime.current?.voice?.setVolume(v);}}/></label><label>Voice sensitivity threshold <output>{Math.round(voiceThreshold*100)}%</output><input aria-label="Voice sensitivity threshold" type="range" min="0" max="1" step=".01" value={voiceThreshold} onChange={e=>{const v=Number(e.target.value);setVoiceThreshold(v);setVoicePref({threshold:v});runtime.current?.voice?.setThreshold(v);}}/></label><p>Lower threshold picks up quieter speech. Voice reaches the room before play; during active play it fades from 5 to 30 meters. Typing, menus and unfocused tabs mute transmission. Spectators cannot transmit.</p><p>Live P2P audio may disclose your IP address to other players. Some networks need a TURN relay. No recording.</p></details></section>;
   const settingsButton=<button className="icon-button settings-trigger" aria-label="Graphics & settings" onClick={e=>openSettings('game',e.currentTarget)}><Settings size={18}/><span>Graphics & settings</span></button>;
  const REPO_URL='https://github.com/mojomast/tokenarena',githubLink=<a className="icon-button github-link" href={REPO_URL} target="_blank" rel="noreferrer noopener" aria-label="View Colosseum Of Competitive Slop source on GitHub" title="View source on GitHub"><GitHubMark size={18}/><span>Source on GitHub</span></a>
  const headActions=<>{<button className="icon-button" aria-label="Patch notes and changelog" title="Patch notes" onClick={()=>changeMode('changelog')}><Sparkles size={18}/><span>Patch notes</span></button>}{settingsButton}<button className="icon-button" aria-label={fullscreen?'Exit full screen':'Enter full screen'} aria-pressed={fullscreen} title={fullscreen?'Exit full screen':'Enter full screen'} onClick={toggleFullscreen}>{fullscreen?<Minimize size={18}/>:<Maximize size={18}/>}<span>Fullscreen</span></button><button className="btn btn-ghost btn-icon" aria-label={muted?'Unmute audio':'Mute audio'} onClick={()=>saveSettings(sensitivity,!muted)}>{muted?<VolumeX size={18}/>:<Volume2 size={18}/>}</button>{githubLink}</>;
  const nextUnlock=matchRewardSummary({profile}).nextUnlock;
  const careerAchievements=achievementStatus(profile,{campaignDone:campaignProgressSummary(CAMPAIGN_MISSIONS as any,campaign).done,campaignTotal:campaignProgressSummary(CAMPAIGN_MISSIONS as any,campaign).total});
  const matchSummary=matchSummaryCard({hud,reward,profile,achievements:careerAchievements,historyEntry:history.entries?.[0]||null});
  // WP3.2: the study controls keep the log in page memory only. Download
  // builds the JSON locally; delete drops the buffer and mints a fresh session.
  const study=studyLogSummary(studyLogRef.current);
  const studyToggle=()=>{const log=studyLogRef.current;const next=setStudyConsent(log,!(log?.enabled===true),{random:Math.random,clockBase:typeof performance!=='undefined'?performance.now():null,buildCommit:studyBuildRef.current});if(next!==log){studyLogRef.current=next;studyDeadRef.current=false;studyFirstActionRef.current=false;setStudyVersion((v:number)=>v+1);}};
  const studyDownload=()=>{const log=studyLogRef.current;const blob=new Blob([serializeStudyLog(log)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`token-arena-study-log-${log?.ephemeralSessionId??'consent-off'}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const studyDelete=()=>{const next=deleteStudyLog(studyLogRef.current,{random:Math.random});if(next!==studyLogRef.current){studyLogRef.current=next;setStudyVersion((v:number)=>v+1);}};
  // WP2.3: Help is the documented way back into the first-run coach. The
  // section is assembled here because the page owns the reopen action.
  const helpSections=[{id:'coach',title:'FIRST-RUN COACH',summary:'Replay the opening walkthrough any time.',items:[
    'Movement, combat and the objective in ten short steps. The copy follows your current key bindings and does not change your progress.',
    <button key="replay-coach" type="button" className="btn btn-ghost" onClick={reopenOnboarding}>OPEN THE COACH</button>,
  ]},...HELP_SECTIONS];
  const ui:UiBag={mode,changeMode,study:{...study,version:studyVersion,onToggle:studyToggle,onDownload:studyDownload,onDelete:studyDelete},enterMenu,exitToTitle,entered,settings,setSettings,setupOpen,setSetupOpen,closeSetup,singleOpen,setSingleOpen,singleSub,setSingleSub,singleMission,setSingleMission,startSinglePlayer,startSpectate,quickStart,startTraining,reward,surpriseMe,nextUnlock,matchSummary,accessibility,setAccessibility,
   continueTutorial,endTutorial,
   character,setCharacter,harness,setHarness,mapId,setMapId,chooseCharacter,chooseGear,chooseAttachment,chooseFinish,chooseCrosshair,shuffle,notice,setNotice,config,setConfig:(v:any)=>setConfig({...normalizeConfig(v),playerName:v.playerName}),display,setDisplay,bindings,setBindings,presets,savePreset,loadPreset,deletePreset,sensitivity,muted,legacyMaps,showcase,touchControls,setTouchPref,saveSettings,connectNet,openBrowser,
   selected,selectedMap,selectedMode,selectableMaps,power,powerIcon,CHARACTERS,HARNESSES,GAME_MODES,DIFFICULTIES,mapsForMode,getMap,missionFor,isMissionUnlocked,CAMPAIGN_MISSIONS,MapPlan,mapViewBox,
   profile,campaign,nextMissionId,isMissionComplete,challenges:challengeStatus(challengeState),weeklyChallenges:weeklyStatus(challengeState),UNLOCKS,UNLOCK_GROUPS,GEAR,GEAR_SLOTS,ATTACHMENTS,ATTACHMENT_SLOTS,WEAPON_FINISHES,CROSSHAIR_STYLES,levelFromXp,rankTitle,rankBlurb,unlockedItems,
   achievements:careerAchievements,ACHIEVEMENTS,prestige:prestigeFromXp(profile.xp),PRESTIGE_TIERS,PRESTIGE_XP,prestigeTier,prestigeXpBonus,
    history,historyTotals:historyTotals(history),historyLeaderboard:historyLeaderboard(history),clearHistory,campaignMissions:campaignMissionView(CAMPAIGN_MISSIONS as any,campaign,singleMission as any),campaignSummary:campaignProgressSummary(CAMPAIGN_MISSIONS as any,campaign),startCampaignMission,settingsTab,setSettingsTab,openSettings,graphicsLab,
   rooms,matches,netUrl,setNetUrl,roomName,setRoomName,netError,quickJoin,createRoom,joinRoom,refreshNet,teamName,renderScoreboard,
   ranked:netRanked,rankedQueued:netQueued,queueRanked,cancelQueue,
   net:netInfo,netPlayers,myPeerId,netRoomId,netConnected:netInfo.connected,chatLog,chatDraft,setChatDraft,sendChat,newMessages,setNewMessages,lobbyInputRef,lobbyChatRef,chatAtBottom,voicePanel,voiceState,hostAndStart,reconnectNet,resumeNet,disconnectNet,
   demos,demoPlaying,refreshDemos:()=>runtime.current?.refreshDemos?.(),start:()=>start(),ready,error,previewRef,headActions,backToDemo,BRAND,showcaseLive,CHANGELOG,RELEASE_VERSION,RELEASE_CODENAME,FULL_CHANGELOG_URL,exportDemo:(id:any)=>runtime.current?.exportDemoFile?.(id),importDemo:(file:any)=>runtime.current?.importDemoFile?.(file),
   player,awards,scoreboard,respawn,switchRespawnLoadout,respawnEditor,setRespawnEditor:setRespawnEditorOpen,respawnQueue,resultTitle,resultDescription,resume,nextArena,campaignNext,isSingle,single,selectHordeUpgrade:chooseHordeUpgrade,resumeSingleplayer,lastDemo,prefs,pauseQuick,toggleCaptions,toggleReducedMotion,ONBOARDING_STEPS,helpSections,onboarding,setOnboarding,finishOnboarding,reopenOnboarding,modalRef,singleRef,settingsRef,onboardingRef,runtime,
   demoNotice,demoPaused,demoTime,demoSpeed,demoRig,demoInfo,stopDemo:()=>runtime.current?.stopDemo?.(),removeDemo:(id:any)=>runtime.current?.removeDemo?.(id),playDemo:(id:any)=>runtime.current?.playDemo?.(id),setDemoPaused,setDemoTime,setDemoSpeed,setDemoRig,CAMERA_RIGS,clock,
   hud,brief,phase,hudRoute,hudMap,hudMode,isTeamMode,modeGoal,ladderStatus,flagText,armsrace,WEAPONS,activePower,radar,radarCols,radarBlip,crosshairGap,marker,reloadFill,reloading,posture,killNotice,suddenBanner,startBanner,scoreCue,damageIndicator,damageNumberStyle,reducedMotion,vehiclePrompt,vehicle,ammoEmpty,ammoLow,hideHud,pointerHint,requestLock,chatOpen,cursor:{active:cursorActive(cursorUi),surfaces:cursorUi.surfaces,label:cursorSurfaceText(cursorUi),hint:cursorHint(cursorUi,{key:bindings.cursor??DEFAULT_BINDINGS.cursor}),key:String(keyLabel(bindings.cursor??DEFAULT_BINDINGS.cursor)).toUpperCase(),blocked:cursorBlockingSurfaces(cursorUi).length>0,resume:cursorResumeCombat},spectatorBoard,spectatorTeams,CAMERA_MODE_LABELS,grenadeStatus,streakStatus,killFeedWeapon,voiceHint,escapeHint,teamScoreText,ammoText,weaponTag,REPO_URL,weaponRangeLabel,cocsCommand,
  };
  return <><main style={{'--ui-scale':display.uiScale??1} as any} className={`arena-app mode-${mode}${(config.mode==='puma-race'||config.mode==='puma-soccer')?' race-setup':''}${(isRace||isSoccer)?' race-active':''} palette-${accessibility.palette}${accessibility.palette!=='default'?' palette-colorblind':''}${accessibility.highContrast?' ui-contrast':''}`}>
  <canvas ref={canvas} tabIndex={-1} role="img" className="arena-canvas" aria-label="Colosseum Of Competitive Slop 3D game"/>
  {!entered&&!demoOnly&&<><TitleScreen ui={ui}/><div className="title-footer"><span>v8.6 · PRISM</span>{githubLink}</div></>}
  {!entered&&demoOnly&&<DemoControls state={demoSession.state} labels={demoLabels} subjects={broadcast?.subjects??[]} cameraStyle={demoSession.cameraStyle} hudVisible={demoSession.hudVisible} pinned={demoPinned(demoSession)} freeSpeed={demoSession.freeSpeed} running={demoRunning} notice={demoSession.notice} error={demoSession.error}
    onEnterArena={enterArenaFromDemo} onPrevScenario={()=>skipDemoScenario(-1)} onNextScenario={()=>skipDemoScenario(1)}
    onAuto={()=>demoTransition({type:'auto'})} onFollow={demoFollow} onFree={demoToggleFree} onStyle={demoCycleStyle} onResetView={demoResetView}
    onToggleHud={demoToggleHud} onOptions={openDemoOptions} onPause={demoTogglePause} onResume={demoTogglePause} onReleasePins={demoReleasePins}
    onSpeed={demoCycleSpeedPref} onLift={(value:number)=>{demoLiftRef.current=value;}}
    music={demoMusic} onMusic={setMusicPref} ambience={demoAmbience} onAmbience={setAmbiencePref} announcer={demoAnnouncer} onAnnouncer={setAnnouncerPref} weather={demoWeather} onWeather={cycleWeather}/>}
  {mode==='selection'&&<SelectionScreen ui={ui}/>}
  {mode==='selection'&&<SetupModal ui={ui}/>}
  {mode==='selection'&&<SinglePlayerModal ui={ui}/>}
  {mode==='progression'&&<ProgressionScreen ui={ui}/>}
  {mode==='changelog'&&<ChangelogScreen ui={ui}/>}
  {mode==='browse'&&<BrowseScreen ui={ui}/>}
  {mode==='theater'&&<TheaterScreen ui={ui}/>}
  {mode==='lobby'&&<LobbyScreen ui={ui}/>}
   {mode==='playing'&&runtime.current?.net?.connected&&<div className={`game-voice ${voiceOpen||voiceState.status==='requesting'||voiceState.error?'voice-open':''}`}>{voiceOpen||voiceState.status==='requesting'||voiceState.error?<div className="voice-docked">{voicePanel}<button className="voice-minimize" onClick={()=>setVoiceOpen(false)} aria-label="Minimize voice panel"><ChevronDown size={14}/></button></div>:<button className={`voice-pill ${voiceState.talking?'talking':''} ${voiceState.enabled?'enabled':''}`} onClick={()=>setVoiceOpen(true)} aria-label="Voice controls"><Mic size={13}/><span>{voiceState.talking?'TRANSMITTING':voiceState.enabled?`VOICE · ${voiceState.status}`:'VOICE · MIC OFF'}</span></button>}</div>}
    {graphicsNotice&&<div className="graphics-hotkey-notice" role="status"><Terminal size={14}/><span>{graphicsNotice}</span></div>}
    {unlock&&<div className="unlock-toast" role="status"><Sparkles size={16}/><div><strong>{unlock.kind==='gear'?'GEAR UNLOCKED':unlock.kind==='attachment'?'WEAPON MOD UNLOCKED':unlock.kind==='finish'?'FINISH UNLOCKED':unlock.kind==='crosshair'?'RETICLE UNLOCKED':'UNLOCKED'}</strong><span>{unlock.name}</span></div>{unlock.gained?<em>+{unlock.gained} XP</em>:null}{unlockQueue.length>1?<em>+{unlockQueue.length-1} MORE</em>:null}<button className="text-button" onClick={()=>setUnlockQueue(q=>q.slice(1))} aria-label="Dismiss unlock">×</button></div>}
    {achievement&&<div className="achievement-toast" role="status" aria-label={`Achievement unlocked: ${achievement.name}`}><Trophy size={16}/><div><strong>ACHIEVEMENT UNLOCKED</strong><span>{achievement.name}</span><small>{achievement.description}</small></div>{achievement.xp?<em>+{achievement.xp} XP</em>:null}{achievementQueue.length>1?<em>+{achievementQueue.length-1} MORE</em>:null}<button className="text-button" onClick={dismissAchievement} aria-label="Dismiss achievement">×</button></div>}
  {entered&&mode==='selection'&&<OnboardingModal ui={ui}/>}
  {showcaseLive&&broadcast&&!demoPlaying&&!error&&!entered&&<DemoBroadcast key={broadcast.revision} data={broadcast} reduced={reducedMotion()||display.reducedMotion===true} visible={demoSession.hudVisible} subjects={broadcast.subjects} activeSubjectId={demoSession.subjectId}/>}
   {error&&<div className="error-banner" role="alert">{error}<button className="secondary-button" onClick={()=>{setError('');if(runtime.current)start();else window.location.reload();}}>RETRY ARENA</button></div>}
   {updateReady&&<div className="update-banner" role="status"><span>A new version of the arena is available.</span><button type="button" className="secondary-button update-reload" onClick={()=>window.location.reload()}>RELOAD</button></div>}
  {(mode==='playing'||mode==='paused')&&player&&<>
   {isSoccer?<SoccerHud soccer={soccer} state={soccerState} actorId={player?.id} touchControls={touchControls} controls={soccerControls}/>:isRace?<RaceHud race={race} touchControls={touchControls} raceControls={raceControls}/>:<PlayingHud ui={ui}/>}
   {hud.net&&<GameChat hud={hud} chatOpen={chatOpen} chatLog={chatLog} chatInputRef={chatInputRef} chatDraft={chatDraft} sendChat={sendChat} setChatOpen={setChatOpen} setChatDraft={setChatDraft}/>}
    {mode==='playing'&&<TouchControls runtime={runtime} mode={hud?.config?.mode} visible={touchControls&&!hud?.spectate} suspended={touchSuspended} interactActive={Boolean(cocsCommand?.interactPrompt||vehiclePrompt)} interactLabel={cocsCommand?.interactPrompt?.verb??'USE'} onLook={touchLook} onSwap={touchSwap} onPause={touchPause} onFullscreen={toggleFullscreen} fullscreen={fullscreen}/>}
   {!entered&&demoOnly&&demoSession.state==='free'&&touchControls&&<TouchControls runtime={runtime} visible onLook={touchLook} onSwap={()=>{}} onPause={demoTogglePause} onFullscreen={toggleFullscreen} fullscreen={fullscreen}/>}
   {scores&&mode==='playing'&&<div className="scores-overlay"><p className="eyebrow">LIVE STANDINGS</p>{scoreboard}</div>}
   {mode==='playing'&&respawn.open&&<RespawnOverlay ui={ui}/>}
  </>}
  {mode==='paused'&&<PauseModal ui={ui}/>}
  {mode==='results'&&hud&&<ResultsModal ui={ui}/>}
  <SettingsDialog ui={ui} opener={settingsOpenerRef.current}/>
  <DemoOptions open={demoOnly&&demoSession.state==='options'} draft={demoSession.draft} draftSelection={demoSession.draftSelection} actual={demoActual} legacy={legacyMaps} dirty={demoOptionsDirty(demoSession)} error={demoSession.error}
    onClose={closeDemoOptions} onDraft={demoSetDraft} onSelection={demoSetSelection} onResetDefaults={demoResetDraft} onApply={()=>demoApplyOptions(false)} onStart={()=>demoApplyOptions(true)}
    music={demoMusic} onMusic={setMusicPref} ambience={demoAmbience} onAmbience={setAmbiencePref} announcer={demoAnnouncer} onAnnouncer={setAnnouncerPref} weather={demoWeather} onWeather={cycleWeather}/>
  </main></>;
}
