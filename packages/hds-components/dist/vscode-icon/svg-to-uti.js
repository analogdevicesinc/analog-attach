export function svgToDataUrl(svgString) {
    const cleaned = svgString.trim().replace(/\s+/g, ' ');
    const encoded = encodeURIComponent(cleaned)
        .replace(/'/g, '%27')
        .replace(/"/g, '%22')
        .replace(/#/g, '%23');
    return `data:image/svg+xml,${encoded}`;
}
//# sourceMappingURL=svg-to-uti.js.map