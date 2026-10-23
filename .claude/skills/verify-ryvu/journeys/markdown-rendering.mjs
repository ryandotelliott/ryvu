export default async function(ctx) {
  if (ctx.instance.mode !== 'dev') throw new Error('markdown-rendering requires VERIFY_MODE=dev to import the rendering helpers');
  const {page}=ctx;
  await ctx.go('/settings');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  const result=await page.evaluate(async()=>{
    const {highlightMarkdownCode,renderMarkdownDiagram}=await import('/src/web/markdown-rendering.ts');
    const code='<img src=x onerror="globalThis.__markdownXss=true">';
    const highlighted=await highlightMarkdownCode(code,'html'),highlightHost=document.createElement('div');highlightHost.innerHTML=highlighted;
    const svg=await renderMarkdownDiagram('%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart LR\nA["<img src=x onerror=alert(1)>"] --> B[Safe]','security-preview',false),diagramHost=document.createElement('div');diagramHost.innerHTML=svg;
    let rejected=false;try{await renderMarkdownDiagram('flowchart LR\nA --> [','invalid-preview',false);}catch{rejected=true;}
    return {code:highlightHost.textContent,executableCode:Boolean(highlightHost.querySelector('img,script')),executableDiagram:Boolean(diagramHost.querySelector('img,script,foreignObject,[onload],[onerror]')),rejected,temp:document.querySelectorAll('body > [id="dinvalid-preview"]').length};
  });
  ctx.check(result.code==='<img src=x onerror="globalThis.__markdownXss=true">'&&!result.executableCode,'highlighted code preserves text and creates no executable HTML');
  ctx.check(!result.executableDiagram,'diagram directives cannot enable HTML labels or scripts');
  ctx.check(result.rejected&&result.temp===0,'an invalid diagram rejects cleanly without leaving error SVGs on the page');
}
