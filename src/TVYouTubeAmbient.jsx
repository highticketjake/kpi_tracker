import { useEffect, useRef } from "react";

/** Lofi stream — https://www.youtube.com/watch?v=jfKfPfyJRdk */
var VIDEO_ID = "jfKfPfyJRdk";
var AMBIENT_VOLUME = 25;

/**
 * Plays YouTube audio only while TV mode is open: no visible player, ~25% volume.
 * Skipped when prefers-reduced-motion is set (matches other TV motion prefs).
 */
export default function TVYouTubeAmbient() {
  var mountRef = useRef(null);
  var playerRef = useRef(null);

  useEffect(function () {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    var cancelled = false;

    function destroy() {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {}
        playerRef.current = null;
      }
    }

    function startPlayer() {
      if (cancelled || !mountRef.current || !window.YT || !window.YT.Player) return;
      playerRef.current = new window.YT.Player(mountRef.current, {
        width: 320,
        height: 180,
        videoId: VIDEO_ID,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: function (ev) {
            if (cancelled) return;
            var p = ev.target;
            try {
              p.setVolume(AMBIENT_VOLUME);
              p.playVideo();
            } catch (e) {}
            window.setTimeout(function () {
              if (cancelled) return;
              try {
                p.setVolume(AMBIENT_VOLUME);
                if (typeof p.unMute === "function") p.unMute();
              } catch (e2) {}
            }, 400);
          },
          onStateChange: function (ev) {
            if (cancelled || !window.YT) return;
            if (ev.data === window.YT.PlayerState.ENDED) {
              try {
                ev.target.playVideo();
              } catch (e) {}
            }
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      startPlayer();
    } else {
      window.__tvYtPending = window.__tvYtPending || [];
      window.__tvYtPending.push(startPlayer);
      if (!window.__tvYtApiLoading) {
        window.__tvYtApiLoading = true;
        var prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () {
          if (typeof prev === "function") prev();
          var q = window.__tvYtPending || [];
          window.__tvYtPending = [];
          q.forEach(function (fn) {
            fn();
          });
        };
        var s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
    }

    return function () {
      cancelled = true;
      destroy();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="pointer-events-none fixed overflow-hidden opacity-0"
      style={{
        width: 320,
        height: 180,
        left: "-9999px",
        top: 0,
      }}
      aria-hidden="true"
    />
  );
}
