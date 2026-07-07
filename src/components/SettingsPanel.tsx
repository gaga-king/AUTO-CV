import React from 'react';
import { Settings, X } from 'lucide-react';
import { Label } from '@/src/components/ui/label';
import { Input } from '@/src/components/ui/input';
import { Button } from '@/src/components/ui/button';

export interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  accessKey: string;
  setAccessKey: (val: string) => void;
  secretKey: string;
  setSecretKey: (val: string) => void;
  useExecutionPrefix: boolean;
  setUseExecutionPrefix: (val: boolean) => void;
  bypassProxy: boolean;
  setBypassProxy: (val: boolean) => void;
  auditBaseUrl: string;
  setAuditBaseUrl: (val: string) => void;
  auditModel: string;
  setAuditModel: (val: string) => void;
  auditApiKey: string;
  setAuditApiKey: (val: string) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  accessKey,
  setAccessKey,
  secretKey,
  setSecretKey,
  useExecutionPrefix,
  setUseExecutionPrefix,
  bypassProxy,
  setBypassProxy,
  auditBaseUrl,
  setAuditBaseUrl,
  auditModel,
  setAuditModel,
  auditApiKey,
  setAuditApiKey
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[160] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-[3rem] p-7 max-w-md w-full shadow-2xl flex flex-col gap-5 animate-in fade-in zoom-in duration-200 max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center shrink-0 mb-2">
                <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-gray-700"/> 系统及配置信息集成设置
                </h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-colors cursor-pointer"><X className="w-4 h-4"/></button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 minimal-scrollbar flex flex-col gap-5 pb-2">
            
            {/* 0. Access Keys */}
            <div className="flex flex-col gap-3 shrink-0 bg-gray-50 border border-gray-100 p-4 rounded-[1.5rem]">
                <Label className="text-xs font-bold text-gray-500 flex items-center gap-1">🔑 鉴权配置 (Lovart API)</Label>
                <div className="flex flex-col gap-3 text-xs">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-bold text-gray-700">Access Key</Label>
                        <Input 
                            value={accessKey} 
                            onChange={(e) => setAccessKey(e.target.value)} 
                            type="password" 
                            placeholder="ak_..." 
                            className="h-10 text-xs bg-white rounded-full border border-gray-200 focus:bg-gray-100 px-4"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-bold text-gray-700">Secret Key</Label>
                        <Input 
                            value={secretKey} 
                            onChange={(e) => setSecretKey(e.target.value)} 
                            type="password" 
                            placeholder="sk_..." 
                            className="h-10 text-xs bg-white rounded-full border border-gray-200 focus:bg-gray-100 px-4"
                        />
                    </div>
                </div>
            </div>

            {/* 1. 常规系统配置 (General System Settings) */}
            <div className="flex flex-col gap-3 shrink-0 bg-gray-50 border border-gray-100 p-4 rounded-[1.5rem]">
                <Label className="text-xs font-bold text-gray-500 flex items-center gap-1">⚙️ 系统快捷状态开关</Label>
                
                {/* Switch 1: 严格执行指令 */}
                <div className="flex items-center justify-between py-1.5 border-b border-gray-150/60">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold text-gray-800">严格执行指令</span>
                        <span className="text-[10px] text-gray-400">强制生图模型遵循完整的提示词指令策略</span>
                    </div>
                    <div className="cursor-pointer" onClick={() => setUseExecutionPrefix(!useExecutionPrefix)}>
                      <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${useExecutionPrefix ? 'bg-[#ccff00]' : 'bg-gray-300'}`}>
                         <div className={`w-4 h-4 rounded-full shadow-md transform transition-transform ${useExecutionPrefix ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white'}`}></div>
                      </div>
                    </div>
                </div>

                {/* Switch 2: 拒绝中转 */}
                <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold text-gray-800">拒绝中转(本地下载)</span>
                        <span className="text-[10px] text-gray-400">不经过服务器中转以加速安全下载、节约流量</span>
                    </div>
                    <div className="cursor-pointer" onClick={() => setBypassProxy(!bypassProxy)}>
                      <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${bypassProxy ? 'bg-[#ccff00]' : 'bg-gray-300'}`}>
                         <div className={`w-4 h-4 rounded-full shadow-md transform transition-transform ${bypassProxy ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white'}`}></div>
                      </div>
                    </div>
                </div>
            </div>



            {/* 3. 一致性审计 (MIMO) 全局配置 */}
            <div className="flex flex-col gap-3 shrink-0 bg-gray-50 border border-gray-100 p-4 rounded-[1.5rem]">
                <Label className="text-xs font-bold text-gray-500">🔍 一致性审计 (MIMO) 渠道与接口</Label>
                
                {/* Quick Presets */}
                <div className="flex flex-col gap-1.5 shrink-0 bg-white border border-gray-100 p-2.5 rounded-xl">
                    <Label className="text-[10px] font-bold text-gray-400">快速应用接口提供商预设：</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                        <button 
                            type="button"
                            onClick={() => {
                                setAuditBaseUrl('https://api.xiaomimimo.com/v1');
                                setAuditModel('mimo-v2.5');
                            }}
                            className={`px-1 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                                (auditBaseUrl.includes('xiaomimimo') && auditModel === 'mimo-v2.5')
                                ? 'bg-black text-white border-black shadow-sm'
                                : 'bg-white hover:bg-gray-100 border-gray-200 text-gray-700'
                            }`}
                        >
                            MIMO 官方
                        </button>
                        <button 
                            type="button"
                            onClick={() => {
                                setAuditBaseUrl('https://api.siliconflow.cn/v1/chat/completions');
                                setAuditModel('vendor/xiaomi/mimo-preview');
                            }}
                            className={`px-1 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                                (auditBaseUrl.includes('siliconflow') && auditModel === 'vendor/xiaomi/mimo-preview')
                                ? 'bg-black text-white border-black shadow-sm'
                                : 'bg-white hover:bg-gray-100 border-gray-200 text-gray-700'
                            }`}
                        >
                            SiliconFlow
                        </button>
                        <button 
                            type="button"
                            onClick={() => {
                                setAuditBaseUrl('https://openrouter.ai/api/v1/chat/completions');
                                setAuditModel('xiaomi/mimo-v2.5');
                            }}
                            className={`px-1 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                                (auditBaseUrl.includes('openrouter') && auditModel === 'xiaomi/mimo-v2.5')
                                ? 'bg-black text-white border-black shadow-sm'
                                : 'bg-white hover:bg-gray-100 border-gray-200 text-gray-700'
                            }`}
                        >
                            OpenRouter
                        </button>
                    </div>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-bold text-gray-700">Audit API Key</Label>
                        <Input 
                            value={auditApiKey} 
                            onChange={(e) => setAuditApiKey(e.target.value)} 
                            type="password" 
                            placeholder="请填写您的 API 密钥..." 
                            className="h-10 text-xs bg-white rounded-full border border-gray-200 focus:bg-gray-100 px-4"
                        />
                        <div className="text-[10px] text-gray-400">
                            * 对于<b>MIMO官方</b>，请填入 <code>MIMO_API_KEY</code>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-bold text-gray-700">API Endpoint (接口地址)</Label>
                        <Input 
                            value={auditBaseUrl} 
                            onChange={(e) => setAuditBaseUrl(e.target.value)} 
                            placeholder="接口地址 (例如: https://api.xiaomimimo.com/v1)" 
                            className="h-10 text-xs bg-white rounded-full border border-gray-200 focus:bg-gray-100 px-4"
                        />
                        <div className="text-[10px] text-gray-400">
                            * 官方推荐：<code>https://api.xiaomimimo.com/v1</code>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-bold text-gray-700">MIMO Model Name (模型名称)</Label>
                        <Input 
                            value={auditModel} 
                            onChange={(e) => setAuditModel(e.target.value)} 
                            placeholder="模型标识 (例如: mimo-v2.5)" 
                            className="h-10 text-xs bg-white rounded-full border border-gray-200 focus:bg-gray-100 px-4"
                        />
                        <div className="text-[10px] text-gray-400">
                            * 官方推荐：<code>mimo-v2.5</code>（或 Pro 系列）
                        </div>
                    </div>
                </div>
            </div>
            </div> {/* End scrollable area */}

            <div className="flex gap-3 mt-1 shrink-0 border-t border-gray-100 pt-3">
                <Button className="flex-1 rounded-full h-11 font-black bg-[#ccff00] text-black hover:bg-[#b8e600] text-xs cursor-pointer shadow-none" onClick={onClose}>
                    确认并保存设置
                </Button>
            </div>
        </div>
    </div>
  );
};
