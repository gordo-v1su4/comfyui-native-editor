import React, { useEffect, useState, useRef } from "react";
import {
  getSavedEndpoint,
  validateModalEndpoint,
  getDefaultSettings,
} from "../../modal-config.js";
import { projectAPI, videoGenerationAPI, wsAPI } from "../api.js";
import { useVideoProgress } from "../contexts/VideoProgressContext";
import { MediaImporter } from "./MediaImporter";

interface ScreenplaySection {
  title: string;
  text: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

interface UserAnswers {
  characters?: string;
  visual_mood?: string;
  genre?: string;
  setting?: string;
  time_of_day?: string;
  color_palette?: string;
  additional_details?: string;
  duration?: string | number;
  num_shots?: string | number;
}

interface ScreenwriterData {
  screenplay: string;
  answers?: UserAnswers;
  transcript?: ChatMessage[];
}

interface ScreenwriterProps {
  projectId: string;
  onBack: () => void;
}

const Screenwriter: React.FC<ScreenwriterProps> = ({ projectId, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [promptIds, setPromptIds] = useState<string[]>([]);
  const progressTimerRef = useRef<number | null>(null);
  const [modalEndpoint, setModalEndpoint] = useState<string>("");
  const { startVideoGeneration } = useVideoProgress();
  const [data, setData] = useState<ScreenwriterData>({
    screenplay: "",
    answers: {},
    transcript: [],
  });

  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const layoutContainerRef = useRef<HTMLDivElement>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem("screenwriterRightWidth");
    const n = saved ? Number(saved) : 360;
    return Number.isFinite(n) && n >= 280 && n <= 800 ? n : 360;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [showMediaPanel, setShowMediaPanel] = useState(false);

  useEffect(() => {
    // Validate projectId before proceeding
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
      console.log('❌ Screenwriter: Invalid projectId, skipping load:', projectId);
      setError('No project selected. Please select or create a project first.');
      setLoading(false);
      return;
    }

    // Load saved Modal endpoint
    const savedEndpoint = getSavedEndpoint();
    setModalEndpoint(savedEndpoint);

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('📝 Screenwriter: Loading project data for:', projectId);

        // Load script using new script endpoint
        try {
          const res = await fetch(
            `${
              import.meta.env.VITE_API_BASE_URL ||
              import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
              window.location.origin
            }/api/projects/${projectId}/script`,
            {
              credentials: "include",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("authToken")}`,
              },
            }
          );

          if (res.status === 404) {
            // Nothing saved yet — don't crash
            console.log("No script found for project - starting fresh");
          } else if (res.ok) {
            const data = await res.json();
            const text = data.screenplay || "";
            const obj = data.screenplayJson || tryParse(text) || null;
            // Use obj for structured UI, or text for a plain editor
            setData((prev) => ({
              ...prev,
              screenplay: text,
            }));
          } else {
            throw new Error(`Failed to load script: ${res.status}`);
          }
        } catch (scriptError: any) {
          console.error("Script loading error:", scriptError);
          setError(`Failed to load script: ${scriptError.message}`);
        }

        // Load chat history
        try {
          const h = await projectAPI.getById(projectId);
          if (h && h.chatHistory) {
            setChatHistory(h.chatHistory || []);
          }
        } catch (chatError: any) {
          if (
            chatError.message?.includes("404") ||
            chatError.message?.includes("not found")
          ) {
            console.log("No chat history found - starting fresh");
            // Don't set error for missing chat history
          } else {
            console.error("Chat history loading error:", chatError);
            // Don't block the UI for chat history errors
          }
        }
      } catch (e: any) {
        if (
          e.message?.includes("400") ||
          e.message?.includes("Invalid project")
        ) {
          setError("Invalid project ID. Please select a valid project.");
        } else if (
          e.message?.includes("401") ||
          e.message?.includes("Unauthorized")
        ) {
          setError("Authentication required. Please log in again.");
        } else if (
          e.message?.includes("404") ||
          e.message?.includes("not found")
        ) {
          setError("Project not found. Please check your project selection.");
        } else {
          setError(e.message || "Failed to load project data");
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId]);

  const save = async () => {
    // Validate projectId before saving
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
      console.log('❌ Screenwriter: Cannot save - invalid projectId:', projectId);
      setError('No project selected. Please select or create a project first.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      console.log('💾 Screenwriter: Saving project data for:', projectId);
      const res = await projectAPI.update(projectId, { script: data });
      setData(res.script);
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Function to update user answers
  const updateAnswer = (field: keyof UserAnswers, value: string) => {
    setData((prev) => ({
      ...prev,
      answers: {
        ...prev.answers,
        [field]: value,
      },
    }));
  };

  // Function to add message to transcript
  const addToTranscript = (message: ChatMessage) => {
    setData((prev) => ({
      ...prev,
      transcript: [...(prev.transcript || []), message],
    }));
  };

  // Function to detect "take the wheel" or generation triggers
  const detectGenerationTrigger = (message: string): boolean => {
    const triggers = [
      "take the wheel",
      "generate now",
      "create the film",
      "make the video",
      "start generation",
      "let's go",
      "proceed",
      "generate",
      // Added: common regeneration intents
      "regenerate",
      "re-generate",
      "rewrite",
      "re-write",
      "revise",
      "update screenplay",
      "improve screenplay",
      "fix screenplay",
      "refresh screenplay",
      "make changes",
      "apply changes",
    ];
    return triggers.some((trigger) =>
      message.toLowerCase().includes(trigger.toLowerCase())
    );
  };

  // Helper function to safely parse JSON
  function tryParse(s: string) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || isStreaming) return;
    if (!projectId) {
      setError("No project selected. Please select or create a project first.");
      return;
    }
    const userMsg: ChatMessage = {
      role: "user",
      content: chatInput,
      timestamp: new Date(),
    };

    // Add to chat history and transcript
    setChatHistory((h) => [...h, userMsg]);
    addToTranscript(userMsg);
    setChatInput("");

    // Check if this is a generation trigger
    const isGenerationTrigger = detectGenerationTrigger(chatInput);

    setIsStreaming(true);

    try {
      // Always send full history and an updated answers snapshot
      const history = (data.transcript || [])
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
        .slice(-16); // keep last ~8 user+assistant turns

      // Update answers based on last assistant question
      function updateAnswers(
        lastAssistantText: string,
        userText: string,
        prev: UserAnswers = {}
      ): UserAnswers {
        const a = { ...prev };
        const la = (lastAssistantText || "").toLowerCase();
        const text = (userText || "").trim();

        const map = [
          { re: /(character|characters)/, key: "characters" },
          {
            re: /(visual\s+mood|mood|visual\s+style|style)/,
            key: "visual_mood",
          },
          { re: /\bgenre\b/, key: "genre" },
          { re: /(setting|location)/, key: "setting" },
          { re: /(time\s+of\s+day|\btime\b)/, key: "time_of_day" },
          { re: /(color\s+palette|colors?)/, key: "color_palette" },
          {
            re: /(additional\s+details|anything\s+else|other\s+important)/,
            key: "additional_details",
          },
          {
            re: /\bduration\b/,
            key: "duration",
            convert: (t: string) => Number(t) || 60,
          },
          {
            re: /(number\s+of\s+shots|\bshots?\b)/,
            key: "num_shots",
            convert: (t: string) => Number(t) || 5,
          },
        ];

        for (const { re, key, convert } of map) {
          if (re.test(la)) {
            (a as any)[key] = convert ? convert(text) : text;
            return a;
          }
        }
        // Safe fallback: if assistant asked for "mood/style" and we missed it above
        return a;
      }

      const lastAssistant = (data.transcript || [])
        .slice()
        .reverse()
        .find((m) => m.role === "assistant");
      const nextAnswers = updateAnswers(
        lastAssistant?.content || "",
        userMsg.content,
        data.answers || {}
      );

      // Update answers in state
      setData((prev) => ({
        ...prev,
        answers: nextAnswers,
      }));

      // Decide when we want strict JSON back from the model
      const screenplayExists = !!(data.screenplay && data.screenplay.trim().length > 0);
      const wantJson = isGenerationTrigger || screenplayExists;

      // Prepare request body
      const requestBody: any = {
        message: isGenerationTrigger ? "take the wheel" : userMsg.content,
        // Prefer the user's requested model; default to latest flash-lite
        model: "gemini-2.5-flash-lite",
        history, // keep if you still use transcript; backend accepts both
        answers: nextAnswers,
        format: wantJson ? "json" : undefined, // Always request JSON once a screenplay exists
      };

      // If it's a generation trigger, use "take the wheel" message
      if (isGenerationTrigger) {
        requestBody.message = "take the wheel";
      }

      const resp = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${projectId}/script/ai/chat`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!resp.ok) {
        if (resp.status === 400) {
          setError("Invalid project ID. Please select a valid project.");
        } else if (resp.status === 401) {
          setError("Authentication required. Please log in again.");
        } else if (resp.status === 404) {
          setError("Project not found. Please check your project selection.");
        } else {
          setError(`Chat request failed: ${resp.status} ${resp.statusText}`);
        }
        setIsStreaming(false);
        return;
      }

      const responseData = await resp.json();

      if (responseData.ok && responseData.reply) {
        // Handle new response format: { ok: true, reply }
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: responseData.reply,
          timestamp: new Date(),
        };
        setChatHistory((h) => [...h, assistantMsg]);
        addToTranscript(assistantMsg);

        // Check if the AI generated a complete screenplay
        if (isGenerationTrigger && responseData.screenplay) {
          // If it's a generation trigger and we got a JSON screenplay, use it directly
          console.log("Received JSON screenplay:", responseData.screenplay);
          setData((prev) => ({
            ...prev,
            screenplay: JSON.stringify(responseData.screenplay, null, 2),
          }));
        } else {
          // Fallback to text parsing for regular chat responses
          const extractedScreenplay = await checkForScreenplayGeneration(
            responseData.reply
          );
          if (extractedScreenplay) {
            setData((prev) => ({
              ...prev,
              screenplay: extractedScreenplay,
            }));
          }
        }
      } else if (responseData.screenplay) {
        // Handle direct screenplay response (non-streaming)
        console.log("Received direct screenplay response:", responseData.screenplay);
        setData((prev) => ({
          ...prev,
          screenplay: JSON.stringify(responseData.screenplay, null, 2),
        }));
      }
    } catch (error) {
      console.error("Chat error:", error);
      setError("Failed to send chat message. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  // Function to check if AI generated a complete screenplay and extract it
  const checkForScreenplayGeneration = async (
    content: string
  ): Promise<string | null> => {
    console.log(
      "Checking for screenplay in content:",
      content.substring(0, 200) + "..."
    );
    console.log("Full content length:", content.length);
    console.log("Content contains '##':", content.includes("##"));
    console.log("Content contains '**Logline:**':", content.includes("**Logline:**"));
    console.log("Content contains 'shot list':", content.includes("shot list"));

    // Look for screenplay indicators that indicate a COMPLETE screenplay was generated
    const screenplayIndicators = [
      /##\s+title:/i, // Markdown title format
      /title:\s*[^\n]+/i, // Title with content
      /logline:\s*[^\n]+/i, // Logline with content
      /genre:\s*[^\n]+/i, // Genre with content
      /synopsis:\s*[^\n]+/i, // Synopsis with content
      /act\s+\d+:/i, // Act structure
      /shot\s+list:/i, // Shot list header
      /duration:\s*\d+s/i, // Duration with seconds
      /location:\s*[^\n]+/i, // Location with content
      /characters:\s*[^\n]+/i, // Characters with content
      /action:\s*[^\n]+/i, // Action with content
      /camera\/motion:\s*[^\n]+/i, // Camera with content
      /composition:\s*[^\n]+/i, // Composition with content
      /text-to-video\s+prompt:\s*[^\n]+/i, // Text-to-video with content
    ];

    console.log("Testing screenplay indicators...");
    const hasScreenplayIndicators = screenplayIndicators.some(
      (indicator, index) => {
        const matches = indicator.test(content);
        console.log(
          `Indicator ${index + 1}: ${indicator.source} - ${
            matches ? "MATCH" : "no match"
          }`
        );
        return matches;
      }
    );

    console.log("Has screenplay indicators:", hasScreenplayIndicators);

    if (hasScreenplayIndicators) {
      console.log("Screenplay indicators detected, attempting extraction...");

      // Additional check: ensure this looks like a complete screenplay, not just questions
      const hasTitle =
        content.includes("title:") ||
        content.includes("**Title:**") ||
        content.includes("**Title**:") ||
        content.includes("## Screenplay:") ||
        content.includes("## Title:") ||
        (content.includes("## ") && content.includes("**Logline:**")) || // Handle markdown headers without colons
        content.match(/##\s+[^\n]+/); // Handle any markdown header like "## The Unexpected Gift"
      const hasLogline =
        content.includes("logline:") ||
        content.includes("**Logline:**") ||
        content.includes("**Logline**:");
      const hasShotList =
        content.includes("shot list:") ||
        content.includes("**Shot List:**") ||
        content.includes("**Shot List**:");
      const hasMinLength = content.length > 500;

      console.log("Structure check:", {
        hasTitle,
        hasLogline,
        hasShotList,
        hasMinLength,
        contentLength: content.length,
      });
      
      // Debug: Show what patterns are being matched
      console.log("Title patterns matched:", {
        hasTitleColon: content.includes("title:"),
        hasTitleBold: content.includes("**Title:**"),
        hasTitleBoldAlt: content.includes("**Title**:") || content.includes("**Title:**"),
        hasScreenplayHeader: content.includes("## Screenplay:"),
        hasTitleHeader: content.includes("## Title:"),
        hasMarkdownHeader: content.includes("## ") && content.includes("**Logline:**"),
        hasAnyMarkdownHeader: !!content.match(/##\s+[^\n]+/),
      });

      const hasCompleteStructure =
        hasTitle && hasLogline && hasShotList && hasMinLength;

      if (!hasCompleteStructure) {
        console.log(
          "Screenplay indicators found but content appears incomplete or just questions"
        );
        return null;
      }

      console.log(
        "Complete screenplay structure detected, proceeding with extraction..."
      );

      // Try to extract the complete screenplay content
      let screenplay = "";

      // Look for the start of the screenplay (usually after "Here is the screenplay package:")
      const startPatterns = [
        /here\s+is\s+the\s+screenplay\s+package:/i,
        /screenplay\s+package:/i,
        /here's\s+the\s+screenplay:/i,
        /okay,\s+i\s+will\s+generate\s+a\s+screenplay\s+for\s+you\./i,
        /okay,\s+let's\s+do\s+it!/i,
        /here's\s+a\s+screenplay\s+package\s+for\s+your\s+short\s+film:/i,
        /here\s+we\s+go!/i,
        /understood\.\s+since\s+you'd\s+like\s+me\s+to\s+take\s+the\s+wheel/i,
        /let's\s+begin!/i,
        /##\s+screenplay:/i,
        /##\s+title:/i,
        /##\s+[^\n]+/i, // Handle markdown headers like "## The Unexpected Gift"
        /##\s+[^\n]+\n\*\*Logline:\*\*/i, // Handle "## Title" followed by "**Logline:**"
        /\*\*\*/i, // Look for *** markers
        /\*\*title:\*\*/i,
        /\*\*title:\s*/i,
        /title:/i,
        /logline:/i,
      ];

      let startIndex = -1;
      for (const pattern of startPatterns) {
        const match = content.match(pattern);
        if (match) {
          startIndex = match.index || 0;
          console.log(
            `Found start pattern: ${pattern.source} at index ${startIndex}`
          );
          break;
        }
      }

      if (startIndex !== -1) {
        // Extract from the start pattern to the end
        screenplay = content.substring(startIndex);
        console.log(
          "Extracted screenplay from start pattern, length:",
          screenplay.length
        );
      } else {
        // Special case: look for content between *** markers
        const asteriskMatch = content.match(/\*\*\*([\s\S]*?)\*\*\*/);
        if (asteriskMatch) {
          console.log("Found content between *** markers");
          screenplay = asteriskMatch[1].trim();
          console.log(
            "Extracted screenplay from *** markers, length:",
            screenplay.length
          );
        } else {
          // Fallback: look for content that looks like a screenplay structure
          const lines = content.split("\n");
          const screenplayLines = [];
          let inScreenplay = false;
          let screenplayStartIndex = -1;

          // Find where the screenplay content starts
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim().toLowerCase();
            if (
              line.includes("title:") ||
              line.includes("logline:") ||
              line.includes("genre:") ||
              line.includes("synopsis:") ||
              line.includes("act") ||
              line.includes("shot list")
            ) {
              screenplayStartIndex = i;
              console.log(`Found screenplay start at line ${i}: ${lines[i]}`);
              break;
            }
          }

          if (screenplayStartIndex !== -1) {
            // Extract from the start line to the end
            screenplay = lines.slice(screenplayStartIndex).join("\n");
            console.log(
              "Extracted screenplay from line detection, length:",
              screenplay.length
            );
          } else {
            // Last resort: try to extract based on common screenplay formatting
            for (const line of lines) {
              const trimmedLine = line.trim();
              // Check if line looks like screenplay content
              if (
                trimmedLine.match(
                  /^(title|logline|genre|synopsis|act|shot|duration|location|characters|action|camera|composition|text-to-video)/i
                )
              ) {
                inScreenplay = true;
              }
              if (inScreenplay) {
                screenplayLines.push(line);
              }
            }

            if (screenplayLines.length > 0) {
              console.log("Fallback screenplay pattern matched");
              screenplay = screenplayLines.join("\n");
            }
          }
        }
      }

      if (screenplay) {
        console.log("Screenplay extracted, length:", screenplay.length);
        console.log("Full extracted content:", screenplay);

        // Clean up the screenplay text
        screenplay = screenplay.trim();

        // Fix formatting issues
        screenplay = screenplay
          .replace(/<center>/g, "") // Remove <center> tags
          .replace(/<\/center>/g, "") // Remove </center> tags
          .replace(/> /g, "") // Remove > symbols at start of dialogue
          .replace(/\*\*/g, "") // Remove ** markdown formatting
          .replace(/\*\*INT\./g, "INT.") // Fix scene headers
          .replace(/\*\*EXT\./g, "EXT.") // Fix scene headers
          .replace(/\*\*INT\/EXT\./g, "INT/EXT.") // Fix scene headers
          .replace(/\*\*([A-Z\s]+\([0-9]+\))\*\*/g, "$1") // Fix character names
          .replace(/\*\*([A-Z\s]+)\*\*/g, "$1"); // Fix other bold text

        console.log(
          "Cleaned screenplay:",
          screenplay.substring(0, 200) + "..."
        );
        return screenplay;
      } else {
        console.log("No screenplay content could be extracted");
      }
    } else {
      console.log("No screenplay indicators detected in content");
    }

    // Return null if no screenplay was found
    return null;
  };

  // Function to extract screenplay using the dedicated extractor
  const extractScreenplay = async (
    extractionType: "auto" | "answers" | "concept",
    data?: any
  ) => {
    try {
      setGeneratingVideos(true);
      setError(null);

      let body: any = { 
        model: "gemini-2.5-flash-lite",
        format: "json" // Request JSON format to match screenplay_format.json structure
      };

      switch (extractionType) {
        case "auto":
          body.message = "Auto mode: generate a complete 60s screenplay package now (use defaults where unspecified).";
          break;
        case "answers":
          body.message = "Generate a complete screenplay based on the provided details.";
          body.answers = data; // { characters, visual_mood, genre, setting, time_of_day, color_palette, additional_details, duration, num_shots }
          break;
        case "concept":
          body.message = data; // Free text concept
          break;
      }

      // Extract screenplay as JSON
      const r1 = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${projectId}/script/ai/chat`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!r1.ok) {
        throw new Error(
          `Screenplay extraction failed: ${r1.status} ${r1.statusText}`
        );
      }

      const d1 = await r1.json();
      const screenplayObj = d1.screenplay; // this is OBJECT

      if (screenplayObj) {
        // Save (server accepts object and returns a string)
        const r2 = await fetch(
          `${
            import.meta.env.VITE_API_BASE_URL ||
            import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
            window.location.origin
          }/api/projects/${projectId}/script`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("authToken")}`,
            },
            body: JSON.stringify({ screenplay: screenplayObj }), // object is fine
          }
        );

        if (r2.ok) {
          const d2 = await r2.json(); // { ok: true, screenplay: "<string>" }
          const screenplayText = d2.screenplay; // always a STRING

          // Set the screenplay string in state
          setData((prev) => ({
            ...prev,
            screenplay: screenplayText,
          }));

          console.log("✅ Extracted screenplay saved to backend");
          alert("🎬 Screenplay extracted and saved successfully!");
        } else {
          throw new Error(`Failed to save screenplay: ${r2.status}`);
        }
      } else {
        throw new Error("No screenplay in response");
      }
    } catch (error) {
      console.error("Screenplay extraction error:", error);
      setError(`Failed to extract screenplay: ${error}`);
    } finally {
      setGeneratingVideos(false);
    }
  };

  // Function to save timeline placements for persistence
  const saveTimelinePlacements = async (currentTimelineClips: any[]) => {
    try {
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL ||
          import.meta.env.VITE_CLOUDFLARE_TUNNEL_URL ||
          window.location.origin
        }/api/projects/${projectId}/timeline/placements`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({
            items: currentTimelineClips.map((c) => ({
              refId: c.mediaId,
              startFrame: c.startFrame,
              durationFrames: c.durationFrames,
              track: c.track || "Generated",
              fps: c.fps || 24,
            })),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to save timeline placements: ${response.status}`
        );
      }

      console.log("✅ Timeline placements saved successfully");
    } catch (error) {
      console.error("Failed to save timeline placements:", error);
      setError(`Failed to save timeline: ${error}`);
    }
  };

  // Auto-scroll chat to bottom when new messages are added
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Listen for new media uploads via WebSocket to show notification
  useEffect(() => {
    if (!projectId) return;
    
    const handleNewMedia = (data: any) => {
      if (data.projectId === projectId) {
        console.log('🎬 Screenwriter: New media uploaded via WebSocket:', data.media?.filename);
        // Show notification that new media is available
        if (data.media?.filename) {
          // Could show a toast notification here
          console.log(`📹 New video generated: ${data.media.filename}`);
        }
      }
    };
    
    const socket = wsAPI.getSocket();
    if (socket) {
      socket.on('media:new', handleNewMedia);
      return () => {
        try { socket.off('media:new', handleNewMedia); } catch {}
      };
    }
  }, [projectId]);

  // Mouse handlers for resizable divider
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing || !layoutContainerRef.current) return;
      const rect = layoutContainerRef.current.getBoundingClientRect();
      // Calculate new width of the right panel based on cursor X
      const newWidth = Math.round(rect.right - e.clientX);
      const clamped = Math.max(280, Math.min(800, newWidth));
      setRightPanelWidth(clamped);
      try { localStorage.setItem("screenwriterRightWidth", String(clamped)); } catch {}
      // Prevent text selection while resizing
      e.preventDefault();
    }
    function onMouseUp() {
      if (isResizing) setIsResizing(false);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing]);

  const generateVideosFromScreenplay = async () => {
    // Validate projectId before generating videos
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
      console.log('❌ Screenwriter: Cannot generate videos - invalid projectId:', projectId);
      setError('No project selected. Please select or create a project first.');
      return;
    }

    if (!data.screenplay.trim()) {
      setError(
        "Please complete the screenplay first before generating videos."
      );
      return;
    }

    try {
      setGeneratingVideos(true);
      setError(null);
      console.log('🎬 Screenwriter: Generating videos for project:', projectId);
      // 1) Preview plan
      const plan = await projectAPI.planFromScreenplay(projectId, {
        screenplay: data.screenplay,
        fps: 12,
        width: 512,
        height: 384,
        negative: "",
      });
      const previewLines = (plan?.shots || [])
        .slice(0, 6)
        .map((s: any) => `#${s.index} (${s.length}f): ${s.prompt}`);
              const confirmMsg =
        `About to generate ${plan?.shots?.length || 0} shots at 512x384 @12fps (max 60 frames).\n\n` +
        previewLines.join("\n") +
        ((plan?.shots?.length || 0) > 6 ? `\n...` : "") +
        `\n\nProceed?`;
      const ok = window.confirm(confirmMsg);
      if (!ok) { setGeneratingVideos(false); return; }

      // 2) Queue generation
      const queueResp = await projectAPI.generateFromScreenplay(projectId, {
        screenplay: data.screenplay,
        fps: 12,
        width: 512,
        height: 384,
        negative: "",
        seed: Math.floor(Math.random() * 1000000),
      });

      const { groupId, shots } = queueResp || {};

      if (groupId && shots) {
        console.log("✅ Video generation started:", { groupId, shots });

        // Prepare shots for progress tracking
        const progressShotsData = shots.map((shot: any, index: number) => ({
          index: index + 1,
          length: shot.length || 60,
          promptId: shot.promptId || shot.clientId,
          clientId: shot.clientId || shot.promptId,
          status: 'pending' as const,
          startTime: Date.now(),
        }));

        // Use global progress context instead of local state
        startVideoGeneration(groupId, progressShotsData, projectId);

        // Show success message with shot count
        alert(
          `🎬 Video generation started!\n\nGroup ID: ${groupId}\nShots: ${shots.length}\nFPS: 12\nResolution: 512x384 (max 60 frames)\n\nProgress monitor will persist across views - you can navigate between Editor and Screenwriter!`
        );

        // Optionally redirect to video editor or show progress
        // You can implement a progress tracking UI here
      } else {
        throw new Error("Invalid response from generation API");
      }
    } catch (error) {
      console.error("Video generation error:", error);
      setError(`Failed to generate videos: ${error}`);
    } finally {
      setGeneratingVideos(false);
    }
  };

  const updateModalEndpoint = () => {
    const newEndpoint = prompt(
      "Enter your Modal ComfyUI endpoint URL:",
      modalEndpoint
    );
    if (newEndpoint && newEndpoint !== modalEndpoint) {
      setModalEndpoint(newEndpoint);
      localStorage.setItem("modalEndpoint", newEndpoint);
    }
  };

  return (
    <div style={{ padding: "16px", height: "100%", display: "flex", flexDirection: "column" }}>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          borderBottom: "1px solid #e9ecef",
          paddingBottom: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>Screenwriter</div>
          <div style={{ fontSize: 12, color: "#666" }}>Draft, iterate, and generate your film screenplay</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack} style={{ padding: "6px 10px" }}>Back</button>
          <button onClick={save} disabled={saving} style={{ padding: "6px 10px" }}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button 
            onClick={() => setShowMediaPanel(!showMediaPanel)} 
            style={{ 
              padding: "6px 10px", 
              backgroundColor: showMediaPanel ? "#4CAF50" : "#666", 
              color: "white", 
              border: "none", 
              borderRadius: "4px" 
            }}
          >
            📁 Media
          </button>
          <button
            onClick={generateVideosFromScreenplay}
            disabled={generatingVideos || !data.screenplay.trim()}
            style={{
              backgroundColor: generatingVideos ? "#666" : "#4CAF50",
              color: "white",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: generatingVideos ? "not-allowed" : "pointer",
            }}
            title="Generate videos from screenplay using AI"
          >
            {generatingVideos ? "Generating..." : "Create Videos"}
          </button>
          <button
            onClick={updateModalEndpoint}
            style={{
              backgroundColor: "#2196F3",
              color: "white",
              border: "none",
              padding: "6px 10px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
            }}
            title="Update Modal ComfyUI endpoint"
          >
            ⚙️ Endpoint
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: "#fff3cd",
            color: "#856404",
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            border: "1px solid #ffeeba",
          }}
        >
          {error}
        </div>
      )}

      <div ref={layoutContainerRef} style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Screenplay Editor */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, marginRight: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Screenplay</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setData((p) => ({ ...p, screenplay: "" }))} style={{ padding: "4px 8px" }}>Clear</button>
              <button onClick={save} disabled={saving} style={{ padding: "4px 8px" }}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
          <div style={{ position: "relative", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", flex: 1, minHeight: 0 }}>
            <textarea
              style={{ width: "100%", height: "100%", resize: "none", padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace", lineHeight: 1.5, border: "none", outline: "none" }}
              placeholder="Paste or write your screenplay here…"
              value={data.screenplay}
              onChange={(e) => setData((p) => ({ ...p, screenplay: e.target.value }))}
            />
          </div>
        </div>
        {/* Vertical divider for resizing */}
        <div
          onMouseDown={() => setIsResizing(true)}
          style={{
            width: 6,
            cursor: "col-resize",
            background: isResizing ? "#4CAF50" : "#e9ecef",
            borderRadius: 3,
            alignSelf: "stretch",
            margin: "0 4px",
            userSelect: "none",
          }}
          title="Drag to resize panels"
        />
        {/* AI Assistant */}
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            width: rightPanelWidth,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>AI Assistant</div>
          <div
            ref={chatContainerRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 8,
              background: "#0b0b0b",
              borderRadius: 4,
              marginBottom: 8,
              color: "#eaeaea",
            }}
          >
            {chatHistory.map((m, idx) => (
              <div key={idx} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "#9aa0a6" }}>
                  {m.role === "user" ? "You" : "Assistant"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
            {isStreaming && (
              <div style={{ color: "#4CAF50", fontSize: "12px" }}>
                AI is generating...
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={async () => {
                const lastAssistantMessage = chatHistory
                  .filter((m) => m.role === "assistant")
                  .pop();
                if (lastAssistantMessage) {
                  const extractedScreenplay = await checkForScreenplayGeneration(
                    lastAssistantMessage.content
                  );
                  if (extractedScreenplay) {
                    setData((prev) => ({
                      ...prev,
                      screenplay: extractedScreenplay,
                    }));
                    alert("Screenplay extracted and loaded.");
                  } else {
                    alert("No screenplay content found in the last AI response.");
                  }
                } else {
                  alert("No AI responses yet. Chat first.");
                }
              }}
              style={{
                backgroundColor: "#FF9800",
                color: "white",
                border: "none",
                padding: "4px 8px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "11px",
              }}
              title="Extract screenplay from the last AI response and load it into the screenplay panel"
            >
              📝 Extract Screenplay
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
              placeholder="Ask the AI to improve or rewrite the screenplay..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <button onClick={sendChat} disabled={isStreaming || !chatInput.trim()}>
              {isStreaming ? "Generating..." : "Send"}
            </button>
          </div>
        </div>
      </div>

      {/* Media Panel - Collapsible */}
      {showMediaPanel && (
        <div style={{ 
          borderTop: "1px solid #e9ecef", 
          padding: "16px", 
          backgroundColor: "#f8f9fa",
          maxHeight: "300px",
          overflow: "auto"
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Generated Videos</div>
          <div style={{ fontSize: 14, color: "#666", padding: "8px 0" }}>
            Switch to the <strong>Editor</strong> tab to view and manage your generated videos.
          </div>
        </div>
      )}
    </div>
  );
};

export default Screenwriter;
