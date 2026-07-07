---
name: batch_generate_operations
description: SOP and technical browser automation guide for Agents operating the Batch Image Generation Web App. Provides Playwright filechooser strategies and pre-flight checklists to drastically reduce agent failure rates during file uploads.
---

# Batch Generation Web App - Agent Operations Guide (操作指南)

This document provides instructions for Agents (or automated systems using Browser MCP / Playwright / Computer Use) interacting with the **Batch Image Generation Web Application**. Follow this strict Standard Operating Procedure (SOP) to avoid infinite loops, tool switching, and file upload failures.

## ⚠️ MANDATORY Technical Implementation for Browser Automation

Agents historically fail at file uploads on this app due to custom UI styling (`opacity-0` on inputs). **DO NOT dispatch sub-agents (explorers) to research upload capabilities. DO NOT switch between Computer Use and Chrome MCP randomly. Use the following exact technical approach.**

### File and Folder Uploads (Playwright / Chrome MCP)
The `<input type="file">` elements are visually hidden under styled UI components. 
- ❌ **DO NOT** try to use standard `setInputFiles()` targeting the hidden input directly (this causes timeout loops and failures).
- ✅ **MUST USE** the `filechooser` mode. 

**Playwright Pattern:**
```javascript
// 1. Wait for the filechooser event
const fileChooserPromise = page.waitForEvent('filechooser');

// 2. Click the visible UI wrapper/label instead of the hidden input
// For Folder: page.locator('text=上传文件夹').click();
// For Table: page.locator('text=上传表格').click();
await page.locator('text=上传文件夹').click(); 

// 3. Set the files
const fileChooser = await fileChooserPromise;
await fileChooser.setFiles('/path/to/your/folder_or_file');
```
*(Note for `webkitdirectory` folder uploads: passing the folder path or an array of file paths to `fileChooser.setFiles` is required depending on your specific MCP environment limitations. Do not get stuck guessing variable names).*

---

## Operating Modes (生图模式)

If the user explicitly tells you the Mode (e.g., "Use Mode A" or "纯文件夹生图"), **skip mode inference** and proceed directly with the user's chosen mode.

### Mode A: Local Folder + Unified Execution (统一批量生图)
**Use Case:** Apply the exact same `提示词` (Prompt) to a batch of images.
1. **Upload Folder:** Follow the `filechooser` pattern to click "上传文件夹" and upload the local directory.
2. **Unified Prompt:** Fill in "统一提示词".
3. **Fixed Image (Optional):** Upload via "选固定图一" using the `filechooser` pattern.
4. **Prompt Concatenation:** Do NOT concatenate table prompts. The Unified Prompt remains unchanged.

### Mode B: Excel Logic Mapping Mode (表格智能匹配模式)
**Use Case:** An Excel sheet maps customized prompts to specific files in an uploaded folder (Matched by `name` column).
1. **Upload Folder:** Use `filechooser` to upload the image folder.
2. **Upload Table:** Use `filechooser` to click "上传表格" and upload the `.xlsx` file. 
3. **Prompt Concatenation Rule:** 
   - The final prompt is `[Unified Prompt] [Table row prompt]`.
   - **CRITICAL:** If you ONLY want the table's prompt to apply, you **MUST clear** the "统一提示词" field entirely.

### Mode C: Pure Table Web Batch Mode (纯表格批量生图)
**Use Case:** Using remote image URLs provided in an Excel file.
1. **Upload Table:** Must contain `name`, `prompt`, and `imageUrl`.
2. **Constraint:** Ensure NO local folder is uploaded. If both are present, clear the folder first.

---

## 🛑 Pre-Flight Execution Checklist (执行前检查清单)

**You MUST mentally or explicitly verify these 5 items before clicking the "启动" (Start) button. Do not skip this checklist.**

1. [ ] **Upload Method Validation:** Did I strictly use the `filechooser` pattern for all file/folder uploads instead of directly writing to hidden inputs?
2. [ ] **Mode Context:** Am I in the correct matching mode (A, B, or C)?
3. [ ] **Prompt Check:** In Mode B, did I consciously clear the Unified Prompt if the user asked to use exclusively the table's prompts?
4. [ ] **Constraint Check:** In Mode C, is the Local Folder empty?
5. [ ] **Generation Rounds:** Is the "生成轮次" (Rounds) set correctly? (Default is 1).

Once all 5 checks pass, locate and click the **启动** button to begin generation.

---

## Task Management & Output
- **Monitoring:** Generation tasks run asynchronously. Monitor UI status (`pending` -> `running` -> `success`/`error`).
- **Retries:** For failed/rejected tasks, use the **"重新生成 (不通过+失败)"** button.
- **Export:** PSD files can be exported from successful task cards. Failed logs can be exported via the "导出失败任务" button.
