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

    // Рекурсивный поиск темы по id
    findThemeById(id, themes = null) {
        if (!themes) themes = this.logic?.themes || [];
        for (const theme of themes) {
            if (theme.id === id) return theme;
            if (theme.subthemes) {
                const found = this.findThemeById(id, theme.subthemes);
                if (found) return found;
            }
        }
        return null;
    }

    findThemeByPath(themes, path) {
        let current = { subthemes: themes };
        for (const id of path) {
            current = (current.subthemes || []).find(t => t.id === id);
            if (!current) return null;
        }
        return current;
    }
}

export default LogicLoader;