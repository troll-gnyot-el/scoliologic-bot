import fs from "fs";

class LogicLoader {
    constructor(filePath) {
        this.filePath = filePath;
        this.logic = null;
        this.lastMtimeMs = 0;
        this.loadLogic();
    }

    loadLogic() {
        try {
            const stat = fs.statSync(this.filePath);
            if (stat.mtimeMs !== this.lastMtimeMs) {
                const data = fs.readFileSync(this.filePath, "utf-8");
                this.logic = JSON.parse(data);
                this.lastMtimeMs = stat.mtimeMs;
                console.log("Logic loaded/updated");
            }
        } catch (e) {
            console.error("Error loading logic:", e);
        }
    }

    getLogic() {
        this.loadLogic();
        return this.logic;
    }

    // Рекурсивный поиск темы по ID
    findThemeById(id, themes) {
        if (!themes) themes = this.logic?.themes;
        if (!themes || !Array.isArray(themes)) return null;

        for (const theme of themes) {
            if (theme.id === id) return theme;
            if (theme.subthemes && theme.subthemes.length > 0) {
                const found = this.findThemeById(id, theme.subthemes);
                if (found) return found;
            }
        }
        return null;
    }
}

export default LogicLoader;