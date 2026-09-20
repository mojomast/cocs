"""Run against public/ served on localhost:8876; needs Playwright Chromium."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:8876/audio/announcer/index.html')
    page.wait_for_function("document.querySelectorAll('audio').length===36")
    assert page.locator('section').count()==12
    results=page.evaluate('''async () => {
      const ctx=new AudioContext();const results=[];
      for(const audio of document.querySelectorAll('audio')) {
        const response=await fetch(audio.src);if(!response.ok)throw Error(audio.src);
        const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
        if(buffer.duration<=.15||buffer.numberOfChannels!==1)throw Error('Invalid decoded audio');
        results.push({file:audio.src.split('/').pop(),duration:buffer.duration});
      }
      const audio=document.querySelectorAll('audio');
      await audio[0].play();await audio[1].play();
      if(!audio[0].paused||audio[1].paused)throw Error('Audition exclusivity failed');
      audio[1].pause();await ctx.close();return results;
    }''')
    assert not errors, errors
    print(f'PASS: {len(results)} WAV files fetched and decoded in Chromium; 12 cue panels; playback and exclusive audition; no page errors')
    browser.close()
