export class ProgressBarService {
    constructor(total, size = 20) {
        this.size = size;
        this.charComplete = "█";
        this.charIncomplete = "░";
        this.total = total || 0;
        this.current = 0;
        this.lastPercent = -1; // Memorizza l'ultima percentuale disegnata
    }

    setTotal(total) {
        this.total = total;
        this.lastPercent = -1; // Reset se cambia il totale
    }

    /**
     * Aggiorna la barra solo se la percentuale è cambiata
     */
    update(label = "Processing", delta = 1) {
        this.current += delta;
        if (this.total <= 0) return;

        const percentage = Math.floor((this.current / this.total) * 100);

        // --- OTTIMIZZAZIONE ---
        // Se la percentuale non è cambiata e non siamo alla fine, non fare nulla
        if (percentage === this.lastPercent && this.current < this.total) {
            return;
        }
        this.lastPercent = percentage;
        // ----------------------

        const progress = Math.floor((this.current / this.total) * this.size);
        const bar = this.charComplete.repeat(progress) +
            this.charIncomplete.repeat(this.size - progress);

        const paddedLabel = label.substring(0, 40).padEnd(40, ' ');
        const output = `\r${paddedLabel}: [${bar}] ${percentage}% | ${this.current}/${this.total}`;

        process.stdout.write(output);

        if (this.current >= this.total) {
            process.stdout.write('\n');
        }
    }

    complete(message = "Done!") {
        console.log(`✅ ${message}`);
    }
}