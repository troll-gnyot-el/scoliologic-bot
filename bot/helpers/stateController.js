export const userStates = new Map();
export const adminStates = new Map();

// --- Управление историей навигации ---
export function pushState(chatId, id) {
    let state = userStates.get(chatId);
    if (!state) {
        state = {
            history: [],
            limb: null,
            amputationLevel: null
        };
    }
    state.history.push(id);
    userStates.set(chatId, state);
}

export function popState(chatId) {
    let state = userStates.get(chatId);
    if (!state || state.history.length <= 1) {
        return null;
    }
    state.history.pop();
    userStates.set(chatId, state);
    return state.history[state.history.length - 1];
}

/*export function getCurrentState(chatId) {
    const state = userStates.get(chatId);
    if (!state || state.history.length === 0) {
        return null;
    }
    return state.history[state.history.length - 1];
}*/
