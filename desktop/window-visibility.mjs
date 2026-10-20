// Restore an existing application window without closing it or changing its data.
export function revealWindow(window,displays=[]) {
 if(!window||window.isDestroyed())return false;
 if(window.isMinimized())window.restore();
 const bounds=window.getBounds();
 const areas=displays.map(display=>display.workArea).filter(Boolean);
 // Keep a useful part of the title bar reachable on at least one display.
 const reachable=areas.some(area=>Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x)>=64&&bounds.y>=area.y&&bounds.y+32<=area.y+area.height);
 if(areas.length&&!reachable){
  const area=areas[0];
  window.setPosition(area.x+Math.max(0,Math.floor((area.width-bounds.width)/2)),area.y+Math.max(0,Math.floor((area.height-bounds.height)/2)));
 }
 window.show();
 window.focus();
 return true;
}
