import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

// TODO: REEMPLAZA ESTO CON LA CONFIGURACIÓN DE TU PROYECTO FIREBASE
const firebaseConfig = {

    apiKey: "AIzaSyAleHi8hH39F1w9dfp7rxkQpx_kCY0AMPg",

    authDomain: "app-toeic-13f00.firebaseapp.com",

    projectId: "app-toeic-13f00",

    storageBucket: "app-toeic-13f00.firebasestorage.app",

    messagingSenderId: "439996304220",

    appId: "1:439996304220:web:9ca5a6bb1cde25e417cf99",

    measurementId: "G-F1J2N4BFQ6"

};


// Initialize Firebase
let app, auth, db, provider;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();
} catch (error) {
    console.error("Firebase no está configurado correctamente aún.", error);
}

const GUEST_PREVIEW_COUNT = 10;
const DAILY_CARD_OPTIONS = [15, 30, 50, 65, 80, 100];

const FAKE_INTERVAL_OPTIONS = ['1m', '5m', '10m', '1h', '6h', '1d', '2d', '4d', '1 mes'];

const PROGRESS_META_KEYS = new Set([
    'currentStreak',
    'cardsStudiedToday',
    'lastStudyDate',
    'lastStreakDate',
    'dailyStreakTarget'
]);

const LOCAL_PROGRESS_KEY = 'toeic-progress';
const LOCAL_SETTINGS_KEY = 'toeic-settings';

function getLocalProgressKey() {
    return `${LOCAL_PROGRESS_KEY}:${currentUser?.uid || ''}`;
}

function getLocalSettingsKey() {
    return `${LOCAL_SETTINGS_KEY}:${currentUser?.uid || ''}`;
}

function saveProgressLocally() {
    if (!currentUser) return;
    try {
        localStorage.setItem(getLocalProgressKey(), JSON.stringify(progress));
        localStorage.setItem(getLocalSettingsKey(), JSON.stringify(userSettings));
    } catch (e) {
        console.error('Error saving progress locally', e);
    }
}

function loadProgressLocally() {
    if (!currentUser) return false;
    try {
        const savedProgress = localStorage.getItem(getLocalProgressKey());
        const savedSettings = localStorage.getItem(getLocalSettingsKey());
        if (savedProgress) progress = JSON.parse(savedProgress);
        if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            userSettings = {
                studiedToday: parsed.studiedToday || 0,
                lastDate: parsed.lastDate || '',
                order: parsed.order || 'random',
                studyMode: normalizeStudyMode(parsed.studyMode)
            };
        }
        return Boolean(savedProgress);
    } catch (e) {
        console.error('Error loading local progress', e);
        return false;
    }
}

function applyLoadedSettings(saved = {}) {
    userSettings = {
        studiedToday: saved.studiedToday || 0,
        lastDate: saved.lastDate || '',
        order: saved.order || 'random',
        studyMode: normalizeStudyMode(saved.studyMode)
    };
    if (els.studyOrderSelect) els.studyOrderSelect.value = userSettings.order;
    if (els.studyModeSelect) els.studyModeSelect.value = userSettings.studyMode;
}

function normalizeStudyMode(mode) {
    if (mode === 'unlimited' || mode === 'active-recall') return '15';
    const value = String(mode);
    return DAILY_CARD_OPTIONS.includes(Number(value)) ? value : '15';
}

function isUnlimitedStudy() {
    return userSettings.studyMode === 'unlimited';
}

function getDailyCardLimit() {
    if (isUnlimitedStudy()) return Infinity;
    return Number(normalizeStudyMode(userSettings.studyMode));
}

function getLocalToday() {
    return new Date().toLocaleDateString('en-CA');
}

function getStreakTarget() {
    if (isUnlimitedStudy()) return null;
    return getDailyCardLimit();
}

function syncDailyStreakTarget() {
    progress.dailyStreakTarget = isUnlimitedStudy() ? null : getDailyCardLimit();
}

function hasCompletedDailyStreakTarget(cardsStudied = progress.cardsStudiedToday || 0) {
    const target = getStreakTarget();
    if (target === null) return false;
    return cardsStudied >= target;
}

function getStudyNewCount(newCount) {
    if (isUnlimitedStudy()) return newCount;
    const remaining = Math.max(0, getDailyCardLimit() - userSettings.studiedToday);
    return Math.min(newCount, remaining);
}

function countStudiedWords() {
    return Object.keys(progress).filter(k => !PROGRESS_META_KEYS.has(k)).length;
}

function hasStartedDeck() {
    return countStudiedWords() > 0;
}

function validateStreakIntegrity() {
    let changed = false;

    if (!hasStartedDeck()) {
        if ((progress.currentStreak || 0) !== 0) {
            progress.currentStreak = 0;
            changed = true;
        }
        if (progress.lastStreakDate) {
            delete progress.lastStreakDate;
            changed = true;
        }
    }

    if ((progress.currentStreak || 0) > 0 && !progress.lastStreakDate) {
        progress.currentStreak = 0;
        changed = true;
    }

    if (changed) saveProgress();
}

// State
let vocabulary = [];
let progress = {};
let sessionCards = [];
let currentIndex = 0;
let currentAudio = null;
let currentUser = null;
let userSettings = { studiedToday: 0, lastDate: "", order: "random", studyMode: "15" };
let isGuestSession = false;
let guestSessionCompleted = false;

// DOM Elements
const els = {
    loading: document.getElementById('loading-overlay'),
    landingView: document.getElementById('landing-view'),
    dashboardView: document.getElementById('dashboard-view'),
    studyStartContainer: document.getElementById('study-start-container'),
    studyView: document.getElementById('study-view'),

    // Headers
    dashboardHeader: document.getElementById('dashboard-header'),
    studyHeader: document.getElementById('study-header'),

    // Auth
    authModal: document.getElementById('auth-modal'),
    googleLoginBtn: document.getElementById('google-login-btn'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    userProfile: document.getElementById('user-profile'),
    userAvatar: document.getElementById('user-avatar'),
    avatarBtn: document.getElementById('avatar-btn'),
    profileDropdown: document.getElementById('profile-dropdown'),
    logoutBtn: document.getElementById('logout-btn'),
    loginStartBtn: document.getElementById('login-start-btn'),
    landingLoginBtn: document.getElementById('landing-login-btn'),

    // Settings
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    studyOrderSelect: document.getElementById('study-order'),
    studyModeSelect: document.getElementById('study-mode'),

    // Stats
    statsContainer: document.getElementById('stats-container'),
    statNew: document.getElementById('stat-new'),
    statLearning: document.getElementById('stat-learning'),
    statReview: document.getElementById('stat-review'),
    studyStatNew: document.getElementById('study-stat-new'),
    studyStatLearning: document.getElementById('study-stat-learning'),
    studyStatReview: document.getElementById('study-stat-review'),
    dashboardSubtitle: document.getElementById('dashboard-subtitle'),
    streakContainer: document.getElementById('streak-container'),
    streakRing: document.getElementById('streak-ring'),
    streakIcon: document.getElementById('streak-icon'),
    streakCount: document.getElementById('streak-count'),
    streakTarget: document.getElementById('streak-target'),

    // Buttons
    startBtn: document.getElementById('start-btn'),
    backToDashBtn: document.getElementById('back-to-dashboard'),
    showAnswerBtn: document.getElementById('show-answer-btn'),
    ratingBtns: document.getElementById('rating-btns'),

    // Flashcard
    flashcard: document.getElementById('flashcard'),
    cardWord: document.getElementById('card-word'),
    cardTranslation: document.getElementById('card-translation'),
    cardEnExample: document.getElementById('card-en-example'),
    cardEsExample: document.getElementById('card-es-example'),

    // Audio Buttons
    frontAudioBtn: document.getElementById('front-audio-btn'),
    backAudioBtn: document.getElementById('back-audio-btn'),
};

// Initialize App
async function init() {
    els.loading.style.opacity = '0';
    setTimeout(() => els.loading.style.display = 'none', 300);
    setupAuthListeners();
}

function resetAuthModalCopy() {
    const authTitle = els.authModal?.querySelector('h2');
    const authText = els.authModal?.querySelector('p');
    if (authTitle) authTitle.textContent = 'Inicio de Sesión Requerido';
    if (authText) {
        authText.textContent =
            'Para guardar tu progreso es necesario iniciar sesión con una cuenta de Google.';
    }
}

function openAuthModal() {
    resetAuthModalCopy();
    els.authModal.classList.remove('hidden');
}

function setupAuthListeners() {
    if (!auth) return;

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            isGuestSession = false;
            guestSessionCompleted = false;
            currentUser = user;
            els.userAvatar.src = user.photoURL;

            // Mostrar elementos de usuario logueado en la cabecera
            els.userProfile.classList.remove('hidden');
            if (els.settingsBtn) els.settingsBtn.classList.remove('hidden');
            if (els.statsContainer) els.statsContainer.classList.remove('hidden');

            // Mostrar vista de Dashboard y ocultar Landing
            if (els.landingView) els.landingView.classList.remove('active');
            els.dashboardView.classList.add('active');
            els.studyView.classList.remove('active');

            els.studyHeader.classList.add('hidden');
            els.dashboardHeader.classList.remove('hidden');

            els.loading.style.display = 'flex';
            els.loading.style.opacity = '1';
            els.loading.querySelector('p').textContent = "Cargando tu progreso y vocabulario...";

            const fetchTasks = [loadProgress()];
            if (vocabulary.length === 0) {
                fetchTasks.push(fetchVocabulary());
            }

            await Promise.all(fetchTasks);

            updateDashboardStats();
            els.loading.style.opacity = '0';
            setTimeout(() => els.loading.style.display = 'none', 300);
        } else {
            currentUser = null;
            progress = {};
            vocabulary = [];

            // Ocultar elementos de usuario en la cabecera
            els.userProfile.classList.add('hidden');
            if (els.settingsBtn) els.settingsBtn.classList.add('hidden');
            if (els.statsContainer) els.statsContainer.classList.add('hidden');

            // Ocultar vistas de estudio y dashboard, mostrar Landing
            els.studyView.classList.remove('active');
            els.dashboardView.classList.remove('active');
            if (els.landingView) els.landingView.classList.add('active');

            els.studyHeader.classList.add('hidden');
            els.dashboardHeader.classList.remove('hidden');

            updateDashboardStats();
            ensureGuestVocabulary();
        }
    });



    els.googleLoginBtn.addEventListener('click', async () => {
        try {
            await signInWithPopup(auth, provider);
            els.authModal.classList.add('hidden');
        } catch (error) {
            console.error("Error signing in", error);
            alert("Error al iniciar sesión: " + error.message);
        }
    });

    if (els.avatarBtn && els.profileDropdown) {
        els.avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            els.profileDropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!els.avatarBtn.contains(e.target)) {
                els.profileDropdown.classList.add('hidden');
            }
        });
    }

    els.logoutBtn.addEventListener('click', () => {
        signOut(auth);
        if (els.profileDropdown) els.profileDropdown.classList.add('hidden');
    });

    if (els.settingsBtn) {
        els.settingsBtn.addEventListener('click', () => {
            els.settingsModal.classList.remove('hidden');
        });
    }

    if (els.closeSettingsBtn) {
        els.closeSettingsBtn.addEventListener('click', () => {
            if (els.studyModeSelect) userSettings.studyMode = normalizeStudyMode(els.studyModeSelect.value);
            if (els.studyOrderSelect) userSettings.order = els.studyOrderSelect.value;
            syncDailyStreakTarget();
            saveProgress();
            updateDashboardStats();
            els.settingsModal.classList.add('hidden');
        });
    }

    els.closeModalBtn.addEventListener('click', () => {
        els.authModal.classList.add('hidden');
        resetAuthModalCopy();
    });
}

async function loadProgress() {
    if (!currentUser) return;

    let loadedFromCloud = false;

    if (db) {
        try {
            const docRef = doc(db, 'users', currentUser.uid);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                progress = data.progress || {};
                applyLoadedSettings(data.settings || {});
                loadedFromCloud = true;
            } else {
                progress = {};
                applyLoadedSettings({});
            }
        } catch (e) {
            console.error('Error loading progress from Firestore', e);
        }
    }

    if (!loadedFromCloud) {
        const loadedLocally = loadProgressLocally();
        if (!loadedLocally) {
            progress = {};
            applyLoadedSettings({});
        } else {
            applyLoadedSettings(userSettings);
        }
    } else {
        saveProgressLocally();
    }

    validateStreakIntegrity();
}

async function saveProgress() {
    if (!currentUser) return;

    saveProgressLocally();

    if (!db) return;

    try {
        const docRef = doc(db, 'users', currentUser.uid);
        await setDoc(docRef, { progress, settings: userSettings }, { merge: true });
    } catch (e) {
        console.error('Error saving progress to Firestore', e);
    }
}

// Fetch and parse CSV
function fetchVocabulary() {
    return new Promise((resolve) => {
        Papa.parse("public/words.csv", {
            download: true,
            header: false,
            skipEmptyLines: true,
            complete: function (results) {
                processVocabulary(results.data);
                resolve();
            },
            error: function (error) {
                console.error("Error reading CSV:", error);
                if (els.loading) els.loading.querySelector('p').textContent = 'Error loading vocabulary file.';
                resolve();
            }
        });
    });
}

function extractAudioFilename(rawStr) {
    if (!rawStr) return null;
    const match = rawStr.match(/\[sound:(.+?)\]/);
    return match ? match[1] : rawStr;
}

function processVocabulary(data) {
    vocabulary = data.map(row => {
        return {
            word: row[0],
            audio: extractAudioFilename(row[1]),
            translation: row[2],
            enExample: row[3],
            esExample: row[4],
            exampleAudio: extractAudioFilename(row[5])
        };
    });
}

function pickFakeIntervalLabel() {
    return FAKE_INTERVAL_OPTIONS[Math.floor(Math.random() * FAKE_INTERVAL_OPTIONS.length)];
}

function setFakeRatingLabels() {
    document.getElementById('time-again').textContent = pickFakeIntervalLabel();
    document.getElementById('time-hard').textContent = pickFakeIntervalLabel();
    document.getElementById('time-good').textContent = pickFakeIntervalLabel();
    document.getElementById('time-easy').textContent = pickFakeIntervalLabel();
}

function formatInterval(ms) {
    if (ms <= 0) return 'ahora';
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.ceil(ms / 3600000);
    if (hours < 24) return `${hours}h`;
    const days = Math.ceil(ms / 86400000);
    if (days >= 30) return `${Math.round(days / 30)} mes`;
    return `${days}d`;
}

function formatScheduledTime(timestamp) {
    if (!timestamp || timestamp <= Date.now()) return 'ahora';
    const d = new Date(timestamp);
    const today = new Date();
    const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `hoy a las ${time}`;
    return d.toLocaleString('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function applySm2Rating(cardData, rating, now = Date.now()) {
    let repetitions = cardData.repetitions || 0;
    let easeFactor = cardData.easeFactor || 2.5;
    let intervalDays = cardData.intervalDays || 0;

    let grade;
    if (rating === 'again') grade = 1;
    else if (rating === 'hard') grade = 2;
    else if (rating === 'good') grade = 4;
    else grade = 5;

    if (grade >= 3) {
        if (repetitions === 0) intervalDays = 1;
        else if (repetitions === 1) intervalDays = 6;
        else intervalDays = Math.round(intervalDays * easeFactor);
        repetitions++;
    } else {
        repetitions = 0;
        intervalDays = 1;
    }

    easeFactor = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    let nextReview;
    if (rating === 'again') {
        nextReview = now + 60 * 1000;
    } else if (rating === 'hard') {
        nextReview = now + 5 * 60 * 1000;
    } else {
        nextReview = now + intervalDays * 24 * 60 * 60 * 1000;
    }

    return {
        nextReview,
        intervalDays,
        repetitions,
        easeFactor,
        interval: intervalDays * 24 * 60 * 60 * 1000
    };
}

function computeCardStats(now = Date.now()) {
    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    vocabulary.forEach(card => {
        const cardProgress = progress[card.word];
        card.isNew = !cardProgress;
        card.isDue = cardProgress && cardProgress.nextReview <= now;
        card.isLearning = cardProgress && cardProgress.nextReview > now;

        if (card.isNew) newCount++;
        else if (card.isDue) reviewCount++;
        else learningCount++;
    });

    const studyNewCount = getStudyNewCount(newCount);
    const availableNow = studyNewCount + reviewCount;

    return { newCount, learningCount, reviewCount, studyNewCount, availableNow };
}

function getNextAvailableTimestamp(now = Date.now()) {
    let nextTime = null;

    vocabulary.forEach(card => {
        const cardProgress = progress[card.word];
        const t = !cardProgress ? now : cardProgress.nextReview;
        if (t <= now) return;
        if (nextTime === null || t < nextTime) nextTime = t;
    });

    return nextTime;
}

function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function daysBetween(dateStrA, dateStrB) {
    const ms = parseLocalDate(dateStrB) - parseLocalDate(dateStrA);
    return Math.round(ms / (1000 * 3600 * 24));
}

function evaluateStreakOnNewDay(today) {
    if (!progress.lastStudyDate) {
        progress.cardsStudiedToday = 0;
        progress.lastStudyDate = today;
        syncDailyStreakTarget();
        return;
    }
    if (progress.lastStudyDate === today) return;

    const daysSinceLastSession = daysBetween(progress.lastStudyDate, today);
    const yesterdayTarget = progress.dailyStreakTarget;
    let completedLastSession = progress.lastStreakDate === progress.lastStudyDate;

    if (!completedLastSession) {
        if (yesterdayTarget == null) {
            completedLastSession = (progress.cardsStudiedToday || 0) > 0;
        } else {
            completedLastSession = (progress.cardsStudiedToday || 0) >= yesterdayTarget;
        }
    }

    if (daysSinceLastSession > 1) {
        progress.currentStreak = 0;
        delete progress.lastStreakDate;
    } else if (daysSinceLastSession === 1 && !completedLastSession) {
        progress.currentStreak = 0;
        delete progress.lastStreakDate;
    }

    progress.cardsStudiedToday = 0;
    progress.lastStudyDate = today;
    syncDailyStreakTarget();
    saveProgress();
}

function updateStreakUI() {
    if (!els.streakContainer) return;

    const today = getLocalToday();

    if (typeof progress.currentStreak === 'undefined') progress.currentStreak = 0;
    if (typeof progress.cardsStudiedToday === 'undefined') progress.cardsStudiedToday = 0;

    if (progress.lastStudyDate !== today) {
        evaluateStreakOnNewDay(today);
    } else if (typeof progress.dailyStreakTarget === 'undefined') {
        syncDailyStreakTarget();
    }

    validateStreakIntegrity();

    const target = getStreakTarget();
    const studiedToday = progress.cardsStudiedToday || 0;
    const circumference = 100.5;

    els.streakCount.textContent = progress.currentStreak;

    if (target === null) {
        els.streakTarget.textContent = `${studiedToday}/∞`;
        els.streakRing.style.strokeDashoffset = `${circumference}`;
        els.streakIcon.classList.add('inactive');
        els.streakIcon.classList.remove('active');
        els.streakRing.classList.remove('completed');
        els.streakContainer.title = 'Racha diaria (sin límite de cartas)';
        return;
    }

    const count = Math.min(studiedToday, target);
    const completed = studiedToday >= target;
    const offset = circumference - (count / target) * circumference;

    els.streakRing.style.strokeDashoffset = `${offset}`;
    els.streakTarget.textContent = `${count}/${target}`;
    els.streakContainer.title = `Racha diaria (${target} cartas/día)`;

    if (completed) {
        els.streakIcon.classList.remove('inactive');
        els.streakIcon.classList.add('active');
        els.streakRing.classList.add('completed');
    } else {
        els.streakIcon.classList.add('inactive');
        els.streakIcon.classList.remove('active');
        els.streakRing.classList.remove('completed');
    }
}

function updateStudyCallToAction(stats, now) {
    if (!els.dashboardSubtitle || !els.startBtn) return;

    const { studyNewCount, reviewCount, availableNow, newCount } = stats;
    const nextTime = getNextAvailableTimestamp(now);
    els.startBtn.disabled = false;
    els.startBtn.classList.remove('is-disabled');

    if (availableNow > 0) {
        const parts = [];
        if (reviewCount > 0) parts.push(`${reviewCount} a repasar`);
        const detail = parts.length ? ` (${parts.join(', ')})` : '';
        const modeNote = isUnlimitedStudy() ? ' (modo sin límite)' : '';
        els.dashboardSubtitle.textContent = `${availableNow} carta${availableNow !== 1 ? 's' : ''} listas para estudiar${detail}${modeNote}.`;
        els.startBtn.textContent = 'Comenzar a estudiar';
        return;
    }

    els.startBtn.disabled = true;
    els.startBtn.classList.add('is-disabled');

    const dailyNewLimitReached = !isUnlimitedStudy()
        && newCount > 0
        && studyNewCount === 0
        && userSettings.studiedToday >= getDailyCardLimit();

    if (dailyNewLimitReached) {
        const dailyLimit = getDailyCardLimit();
        els.dashboardSubtitle.textContent = nextTime
            ? `Hoy ya estudiaste tus ${dailyLimit} cartas nuevas. Próxima carta ${formatScheduledTime(nextTime)}.`
            : `Hoy ya estudiaste tus ${dailyLimit} cartas nuevas.`;
    } else if (nextTime) {
        els.dashboardSubtitle.textContent = `Nada listo ahora. Próxima carta ${formatScheduledTime(nextTime)}.`;
    } else if (newCount === 0) {
        els.dashboardSubtitle.textContent = 'Has visto todas las palabras del mazo.';
    } else {
        els.dashboardSubtitle.textContent = 'No hay cartas listas en este momento.';
    }

    els.startBtn.textContent = 'Sin cartas por ahora';
}

function updateDashboardStats() {
    if (vocabulary.length === 0) {
        els.statNew.textContent = "0";
        if (els.statLearning) els.statLearning.textContent = "0";
        if (els.statReview) els.statReview.textContent = "0";
        if (els.studyStatNew) els.studyStatNew.textContent = "0";
        if (els.studyStatLearning) els.studyStatLearning.textContent = "0";
        if (els.studyStatReview) els.studyStatReview.textContent = "0";

        const pillReview = document.getElementById('pill-review');
        const studyPillReview = document.getElementById('study-pill-review');
        if (pillReview) pillReview.classList.remove('highlight');
        if (studyPillReview) studyPillReview.classList.remove('highlight');
        updateStreakUI();
        return;
    }

    const now = Date.now();
    const today = getLocalToday();

    if (userSettings.lastDate !== today) {
        userSettings.studiedToday = 0;
        userSettings.lastDate = today;
        saveProgress();
    }

    const stats = computeCardStats(now);
    const { learningCount, reviewCount, studyNewCount, availableNow } = stats;

    els.statNew.textContent = studyNewCount;
    if (els.statLearning) els.statLearning.textContent = learningCount;
    if (els.statReview) els.statReview.textContent = reviewCount;
    if (els.studyStatNew) els.studyStatNew.textContent = studyNewCount;
    if (els.studyStatLearning) els.studyStatLearning.textContent = learningCount;
    if (els.studyStatReview) els.studyStatReview.textContent = reviewCount;

    const pillReview = document.getElementById('pill-review');
    const studyPillReview = document.getElementById('study-pill-review');
    if (reviewCount > 0) {
        if (pillReview) pillReview.classList.add('highlight');
        if (studyPillReview) studyPillReview.classList.add('highlight');
    } else {
        if (pillReview) pillReview.classList.remove('highlight');
        if (studyPillReview) studyPillReview.classList.remove('highlight');
    }

    updateStudyCallToAction(stats, now);
    updateStreakUI();
}

function playAudio(filename) {
    if (!filename) return;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    currentAudio = new Audio(`public/audios/${filename}`);
    currentAudio.play().catch(e => console.log("Audio play prevented:", e));
}

// Event Listeners
els.startBtn.addEventListener('click', startSession);
els.backToDashBtn.addEventListener('click', endSession);
els.showAnswerBtn.addEventListener('click', showAnswer);

// Rating Buttons
document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.rating-btn');
        if (targetBtn) {
            handleRating(targetBtn.dataset.rating);
        }
    });
});

async function ensureGuestVocabulary() {
    if (currentUser || vocabulary.length > 0) return;
    try {
        await fetchVocabulary();
    } catch (e) {
        console.error("Error loading guest vocabulary", e);
    }
}

async function startGuestSession() {
    if (currentUser) {
        startSession();
        return;
    }

    els.loading.style.display = 'flex';
    els.loading.style.opacity = '1';
    els.loading.querySelector('p').textContent = 'Cargando vocabulario...';

    await ensureGuestVocabulary();

    els.loading.style.opacity = '0';
    setTimeout(() => els.loading.style.display = 'none', 300);

    if (vocabulary.length === 0) {
        alert('No se pudo cargar el vocabulario. Inténtalo de nuevo.');
        return;
    }

    const shuffled = [...vocabulary].sort(() => Math.random() - 0.5);
    sessionCards = shuffled.slice(0, GUEST_PREVIEW_COUNT);
    isGuestSession = true;
    guestSessionCompleted = false;
    currentIndex = 0;

    if (els.landingView) els.landingView.classList.remove('active');
    els.dashboardView.classList.remove('active');
    els.studyView.classList.add('active');
    els.dashboardHeader.classList.add('hidden');
    els.studyHeader.classList.remove('hidden');

    const studyStats = document.getElementById('study-stats');
    if (studyStats) studyStats.classList.add('hidden');

    showCard();
}

function startSession() {
    if (!currentUser) {
        startGuestSession();
        return;
    }

    if (vocabulary.length === 0) {
        alert("El vocabulario aún se está cargando o está vacío. Por favor, espera.");
        return;
    }

    const today = getLocalToday();
    if (userSettings.lastDate !== today) {
        userSettings.studiedToday = 0;
        userSettings.lastDate = today;
    }

    computeCardStats();

    let dueCards = vocabulary.filter(card => card.isDue);
    let newCards = vocabulary.filter(card => card.isNew);

    if (userSettings.order === 'alphabetical') {
        newCards.sort((a, b) => a.word.localeCompare(b.word));
    } else {
        newCards.sort(() => Math.random() - 0.5);
    }

    if (!isUnlimitedStudy()) {
        const newCardsAvailableToday = Math.max(0, getDailyCardLimit() - userSettings.studiedToday);
        newCards = newCards.slice(0, newCardsAvailableToday);
    }

    sessionCards = [...dueCards, ...newCards];

    if (sessionCards.length === 0) {
        updateDashboardStats();
        return;
    }

    if (userSettings.order === 'alphabetical') {
        sessionCards.sort((a, b) => a.word.localeCompare(b.word));
    } else {
        sessionCards.sort(() => Math.random() - 0.5);
    }

    currentIndex = 0;
    els.dashboardView.classList.remove('active');
    els.studyView.classList.add('active');
    els.dashboardHeader.classList.add('hidden');
    els.studyHeader.classList.remove('hidden');

    showCard();
}

function fitTextToCard(element, minPx = 14) {
    if (!element) return;

    element.style.fontSize = '';
    const container = element.closest('.card-content');
    if (!container) return;

    const maxWidth = container.clientWidth;
    if (maxWidth <= 0) return;

    let size = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${size}px`;

    while (element.scrollWidth > maxWidth && size > minPx) {
        size -= 1;
        element.style.fontSize = `${size}px`;
    }
}

function fitCardTexts() {
    fitTextToCard(els.cardWord);
    fitTextToCard(els.cardTranslation);
}

function showCard() {
    if (currentIndex >= sessionCards.length) {
        if (isGuestSession) guestSessionCompleted = true;
        endSession();
        return;
    }

    const card = sessionCards[currentIndex];

    els.flashcard.classList.remove('flipped');
    els.showAnswerBtn.classList.remove('hidden');
    els.ratingBtns.classList.add('hidden');

    els.cardWord.textContent = card.word;
    els.cardTranslation.textContent = card.translation;
    els.cardEnExample.textContent = card.enExample;
    els.cardEsExample.textContent = card.esExample;

    els.frontAudioBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(card.audio);
    };
    els.backAudioBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(card.exampleAudio);
    };

    setTimeout(() => playAudio(card.audio), 300);

    requestAnimationFrame(() => fitCardTexts());
}

function showAnswer() {
    els.flashcard.classList.add('flipped');
    els.showAnswerBtn.classList.add('hidden');
    els.ratingBtns.classList.remove('hidden');

    if (isGuestSession) {
        setFakeRatingLabels();
        return;
    }

    const card = sessionCards[currentIndex];
    const cardData = progress[card.word] || {};
    const now = Date.now();

    const preview = (rating) => {
        const result = applySm2Rating(cardData, rating, now);
        return formatInterval(result.nextReview - now);
    };

    document.getElementById('time-again').textContent = preview('again');
    document.getElementById('time-hard').textContent = preview('hard');
    document.getElementById('time-good').textContent = preview('good');
    document.getElementById('time-easy').textContent = preview('easy');
}

els.flashcard.addEventListener('click', (e) => {
    if (e.target.closest('.audio-btn')) return;

    if (els.showAnswerBtn.classList.contains('hidden')) {
        els.flashcard.classList.toggle('flipped');
    } else {
        showAnswer();
    }
});

function handleRating(rating) {
    const card = sessionCards[currentIndex];

    if (isGuestSession) {
        currentIndex++;
        showCard();
        return;
    }

    const now = Date.now();
    const cardData = progress[card.word] || {};
    const sm2 = applySm2Rating(cardData, rating, now);

    if (rating === 'again' || rating === 'hard') {
        sessionCards.push(card);
    }

    if (!progress[card.word] && !isUnlimitedStudy()) {
        userSettings.studiedToday++;
    }

    const today = getLocalToday();
    if (progress.lastStudyDate !== today) {
        evaluateStreakOnNewDay(today);
    }

    progress.cardsStudiedToday++;

    if (hasCompletedDailyStreakTarget() && progress.lastStreakDate !== today) {
        progress.currentStreak = (progress.currentStreak || 0) + 1;
        progress.lastStreakDate = today;
    }

    progress[card.word] = sm2;

    // Guardar en Firebase (asíncrono, no bloqueamos el UI)
    saveProgress();
    updateDashboardStats();

    // Si es "Otra vez", no avanzamos el índice para que se repita inmediatamente en pantalla.
    // Como ya hicimos sessionCards.push(card) arriba, también aparecerá de nuevo al final de la sesión.
    if (rating !== 'again') {
        currentIndex++;
    }

    showCard();
}

function endSession() {
    const wasGuest = isGuestSession;
    const promptLogin = wasGuest && guestSessionCompleted;

    isGuestSession = false;
    guestSessionCompleted = false;

    els.studyView.classList.remove('active');
    els.studyHeader.classList.add('hidden');
    els.dashboardHeader.classList.remove('hidden');

    const studyStats = document.getElementById('study-stats');
    if (studyStats) studyStats.classList.remove('hidden');

    if (wasGuest) {
        if (els.landingView) els.landingView.classList.add('active');
        els.dashboardView.classList.remove('active');
        if (promptLogin) {
            const authTitle = els.authModal.querySelector('h2');
            const authText = els.authModal.querySelector('p');
            if (authTitle) authTitle.textContent = '¡Buen trabajo!';
            if (authText) {
                authText.textContent =
                    'Completaste tus primeras 10 cartas. Inicia sesión con Google para guardar tu progreso y seguir estudiando.';
            }
            els.authModal.classList.remove('hidden');
        }
        return;
    }

    els.dashboardView.classList.add('active');
    updateDashboardStats();
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
    const landingYear = document.getElementById('landing-year');
    if (landingYear) landingYear.textContent = new Date().getFullYear();

    // Botón 'Empezar' — siempre activo, independiente de Firebase
    if (els.loginStartBtn) {
        els.loginStartBtn.addEventListener('click', () => {
            startGuestSession();
        });
    }

    if (els.landingLoginBtn) {
        els.landingLoginBtn.addEventListener('click', () => {
            openAuthModal();
        });
    }

    if (els.studyOrderSelect) {
        els.studyOrderSelect.addEventListener('change', (e) => {
            userSettings.order = e.target.value;
            saveProgress();
            updateDashboardStats();
        });
    }
    if (els.studyModeSelect) {
        els.studyModeSelect.addEventListener('change', (e) => {
            userSettings.studyMode = normalizeStudyMode(e.target.value);
            syncDailyStreakTarget();
            saveProgress();
            updateDashboardStats();
        });
    }
    window.addEventListener('resize', () => {
        if (els.studyView?.classList.contains('active')) {
            fitCardTexts();
        }
    });
    window.addEventListener('beforeunload', () => {
        if (currentUser) saveProgressLocally();
    });
    init();
    initInstallBanner();
});

const INSTALL_DISMISSED_KEY = 'toeic-pwa-install-dismissed';
let deferredInstallPrompt = null;

function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function showInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (!banner || isAppInstalled() || localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
    banner.classList.remove('hidden');
}

function hideInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.add('hidden');
}

function initInstallBanner() {
    const installBtn = document.getElementById('install-app-btn');
    const dismissBtn = document.getElementById('install-dismiss-btn');

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        showInstallBanner();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        hideInstallBanner();
    });

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;

            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            hideInstallBanner();
        });
    }

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
            hideInstallBanner();
        });
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}
