import { definePlugin, useCallback, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, CanvasNodePanelProps, CanvasStoredImage } from "@infinite-canvas/plugin-sdk";
import styles from "./styles.css";

const PANORAMA_PROMPT =
    "生成一张用于3D预演背景的无缝360度等距柱状全景图，2:1画幅，水平线稳定，左右边缘无缝衔接，无文字无水印。场景：";

type DirectorProject = Record<string, unknown> & { version: 1 };
type DirectorCapture = { dataUrl?: unknown; fileName?: unknown };

function imageMetadata(image: CanvasStoredImage) {
    return {
        content: image.url,
        storageKey: image.storageKey,
        status: "success" as const,
        naturalWidth: image.width,
        naturalHeight: image.height,
        bytes: image.bytes,
        mimeType: image.mimeType,
    };
}

function getImageInput(ctx: CanvasNodeContext) {
    const generated = ctx.node.metadata?.panoramaUrl;
    if (typeof generated === "string" && generated) {
        return { nodeId: ctx.node.id, title: "AI 场景全景图", url: generated };
    }
    const upstream = ctx.getUpstream().find((node) => typeof node.metadata?.content === "string" && node.metadata.content);
    return upstream
        ? { nodeId: upstream.id, title: upstream.title || "画布参考图", url: String(upstream.metadata?.content) }
        : null;
}

function openDirector(ctx: CanvasNodeContext) {
    ctx.updateMetadata({ directorOpen: true });
}

function DirectorContent({ ctx }: CanvasNodeContentProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const isOpen = ctx.node.metadata?.directorOpen === true;
    const preview = typeof ctx.node.metadata?.content === "string" ? ctx.node.metadata.content : "";
    const directorUrl = new URL("director-desk/index.html", new URL(ctx.baseUrl, window.location.origin)).toString();

    const closeDirector = useCallback(() => {
        dialogRef.current?.close();
        ctx.updateMetadata({ directorOpen: false });
    }, [ctx]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog || !isOpen) return;
        if (!dialog.open) dialog.showModal();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const iframe = iframeRef.current;
        if (!iframe) return;
        const frameWindow = iframe.contentWindow;
        if (!frameWindow) return;
        const targetWindow: Window = frameWindow;
        const instanceId = ctx.node.id;

        async function sendSession() {
            const project = await ctx.storage.get<DirectorProject>(`project:${instanceId}`);
            targetWindow.postMessage(
                {
                    type: "storyai:director-desk-session",
                    payload: {
                        instanceId,
                        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
                        project,
                    },
                },
                window.location.origin,
            );
            const input = getImageInput(ctx);
            if (!input) return;
            const edge = ctx.getConnections().find((item) => item.fromNodeId === input.nodeId && item.toNodeId === instanceId);
            targetWindow.postMessage(
                {
                    type: "storyai:director-desk-panorama",
                    payload: { edgeId: edge?.id || "", sourceNodeId: input.nodeId, imageUrl: input.url, fileName: input.title },
                },
                window.location.origin,
            );
        }

        async function handleMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin || event.source !== targetWindow) return;
            const data = event.data as { type?: string; payload?: Record<string, unknown> };
            if (data.type === "storyai:director-desk-ready") {
                await sendSession();
                return;
            }
            if (data.type === "storyai:director-desk-close") {
                closeDirector();
                return;
            }
            if (data.type === "storyai:director-desk-project-changed") {
                const project = data.payload?.project;
                if (data.payload?.instanceId === instanceId && project && typeof project === "object") {
                    await ctx.storage.set(`project:${instanceId}`, project);
                }
                return;
            }
            if (data.type === "storyai:director-desk-panorama-removed") {
                const edgeId = data.payload?.edgeId;
                if (typeof edgeId === "string" && edgeId) ctx.applyOps([{ type: "delete_connections", ids: [edgeId] }]);
                return;
            }
            if (data.type !== "storyai:director-desk-captures-sent") return;
            const captures = Array.isArray(data.payload?.captures) ? (data.payload?.captures as DirectorCapture[]) : [];
            const normalized = captures.filter((item): item is DirectorCapture & { dataUrl: string } => typeof item?.dataUrl === "string" && Boolean(item.dataUrl));
            if (!normalized.length) return;
            const stored = await Promise.all(normalized.map((item) => ctx.assets.saveImage(item.dataUrl)));
            const gap = 32;
            const ops = stored.flatMap((image, index) => {
                const id = `director-capture-${instanceId}-${Date.now()}-${index}`;
                const width = 320;
                const height = Math.max(180, Math.round(width * image.height / Math.max(1, image.width)));
                return [
                    {
                        type: "add_node" as const,
                        id,
                        nodeType: "image",
                        title: typeof normalized[index]?.fileName === "string" ? normalized[index].fileName : `导演台截图 ${index + 1}`,
                        x: ctx.node.position.x + ctx.node.width + 72,
                        y: ctx.node.position.y + index * (height + gap),
                        width,
                        height,
                        metadata: imageMetadata(image),
                    },
                    { type: "connect_nodes" as const, fromNodeId: instanceId, toNodeId: id },
                ];
            });
            ctx.applyOps(ops);
            ctx.updateMetadata(imageMetadata(stored[stored.length - 1]));
        }

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [closeDirector, ctx, isOpen]);

    return (
        <div className="director-desk-node" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()}>
            {preview ? (
                <img src={preview} alt="导演台当前机位" />
            ) : (
                <div className="director-desk-node-empty" style={{ background: ctx.theme.node.fill, color: ctx.theme.node.text }}>
                    <div>
                        <strong>3D 导演台</strong>
                        <span style={{ color: ctx.theme.node.placeholder }}>搭建场景、安排角色和机位</span>
                    </div>
                </div>
            )}
            <button className="director-desk-open" type="button" onClick={() => openDirector(ctx)}>打开导演台</button>
            <dialog ref={dialogRef} className="director-desk-dialog" onClose={() => ctx.updateMetadata({ directorOpen: false })} onCancel={(event) => { event.preventDefault(); closeDirector(); }}>
                {isOpen ? <iframe ref={iframeRef} title={`${ctx.node.title} 3D 编辑器`} src={`${directorUrl}?instanceId=${encodeURIComponent(ctx.node.id)}`} allow="fullscreen" /> : null}
            </dialog>
        </div>
    );
}

function DirectorPanel({ ctx, onClose }: CanvasNodePanelProps) {
    const [prompt, setPrompt] = useState(typeof ctx.node.metadata?.prompt === "string" ? ctx.node.metadata.prompt : "");
    const [status, setStatus] = useState("");
    const [running, setRunning] = useState(false);

    async function generatePanorama() {
        const scene = prompt.trim();
        if (!scene || running) return;
        setRunning(true);
        setStatus("正在生成场景背景…");
        try {
            const references = ctx.getUpstream().map((node) => node.metadata?.content).filter((item): item is string => typeof item === "string" && Boolean(item));
            const result = await ctx.ai.generateImage(`${PANORAMA_PROMPT}${scene}`, { count: 1, size: "1536x1024", references });
            const image = result.images[0];
            if (!image) throw new Error("模型没有返回图片");
            const stored = await ctx.assets.saveImage(image);
            ctx.updateMetadata({ ...imageMetadata(stored), panoramaUrl: stored.url, panoramaStorageKey: stored.storageKey, prompt: scene });
            setStatus("场景背景已生成，可以进入导演台布置角色和机位");
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "场景背景生成失败");
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="director-desk-panel" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()}>
            <textarea
                value={prompt}
                placeholder="描述想要搭建的场景，支持连接参考图"
                onChange={(event) => setPrompt(event.target.value)}
                onBlur={() => ctx.updateMetadata({ prompt })}
                onWheel={(event) => event.stopPropagation()}
                style={{ border: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.fill, color: ctx.theme.node.text }}
            />
            <div className="director-desk-panel-actions">
                <button type="button" onClick={onClose} style={{ color: ctx.theme.node.muted }}>收起</button>
                <div>
                    <button type="button" onClick={() => openDirector(ctx)} style={{ color: ctx.theme.node.text }}>打开导演台</button>
                    <button type="button" disabled={!prompt.trim() || running} onClick={() => void generatePanorama()} style={{ color: ctx.theme.node.text }}>
                        {running ? "生成中…" : "生成场景"}
                    </button>
                </div>
            </div>
            <div className="director-desk-status" style={{ color: ctx.theme.node.placeholder }}>{status}</div>
        </div>
    );
}

export default definePlugin({
    id: "director-desk",
    name: "3D 导演台",
    version: "1.0.0",
    description: "在画布中搭建3D场景、安排角色与机位，并将拍摄结果回传为图片节点",
    css: styles,
    nodes: [
        {
            type: "director-desk:scene",
            title: "导演台",
            icon: "🎬",
            description: "3D 场景预演与机位设计",
            defaultSize: { width: 440, height: 440 },
            defaultMetadata: { prompt: "", directorOpen: false },
            minimapColor: "#d5a83d",
            autoOpenPanel: true,
            Content: DirectorContent,
            Panel: DirectorPanel,
            resource: (node) => typeof node.metadata?.content === "string" && node.metadata.content ? { kind: "image", url: node.metadata.content } : null,
            onDoubleClick: (ctx) => {
                openDirector(ctx);
                return true;
            },
            toolbar: (ctx) => [{ id: "director-open", title: "打开3D导演台", label: "打开", icon: "↗", onClick: () => openDirector(ctx) }],
        },
    ],
});
