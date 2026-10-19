import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Chip, Contactless } from './icons';
import { STAGES } from './storyStages';
import '../story.css';

gsap.registerPlugin(ScrollTrigger);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function SecurityStory({ onBack }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef(null);
  const pinRef = useRef(null);
  const sceneRef = useRef(null);
  const spiralRef = useRef(null);
  const clusterRef = useRef(null);
  const cardRef = useRef(null);
  const readerRef = useRef(null);
  const glowRef = useRef(null);
  const meterRef = useRef(null);
  const nodeRefs = useRef([]);
  const panelRefs = useRef([]);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);

  useGSAP(() => {
    if (reduced) return undefined;
    const pin = pinRef.current;
    const spiral = spiralRef.current;
    const scene = sceneRef.current;
    if (!pin || !spiral || !scene) return undefined;

    const mm = gsap.matchMedia();

    const build = (end, spiralZ) => {
      scene.style.setProperty('--spiral-z', spiralZ);
      const nodes = nodeRefs.current.filter(Boolean);
      const panels = panelRefs.current.filter(Boolean);
      const step = 360 / STAGES.length;
      const span = STAGES.length;

      gsap.set(spiral, { rotateY: 0 });
      gsap.set(nodes[0], { opacity: 1, scale: 1 });
      nodes.slice(1).forEach((node) => gsap.set(node, { opacity: 0.28, scale: 0.92 }));
      gsap.set(panels[0], { autoAlpha: 1, y: 0 });
      panels.slice(1).forEach((panel) => gsap.set(panel, { autoAlpha: 0, y: 22 }));
      if (meterRef.current) gsap.set(meterRef.current, { scaleX: 1 / span });

      const timeline = gsap.timeline({
        scrollTrigger: {
          id: 'how-tap-stays-safe',
          trigger: pin,
          start: 'top top',
          end,
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onToggle: (self) => {
            scene.classList.toggle('is-live', self.isActive);
          },
          onUpdate: (self) => {
            const next = Math.min(STAGES.length - 1, Math.floor(self.progress * STAGES.length));
            if (next !== activeRef.current) {
              activeRef.current = next;
              setActive(next);
            }
          },
        },
      });

      for (let index = 1; index < STAGES.length; index += 1) {
        timeline.to(panels[index - 1], { autoAlpha: 0, y: -14, duration: 0.18, ease: 'power1.out' }, index);
        timeline.fromTo(
          panels[index],
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power1.out' },
          index + 0.04
        );
        timeline.to(spiral, { rotateY: -index * step, duration: 0.55, ease: 'power2.inOut' }, index);
        timeline.to(nodes[index - 1], { opacity: 0.28, scale: 0.92, duration: 0.4 }, index);
        timeline.to(nodes[index], { opacity: 1, scale: 1, duration: 0.4 }, index);
      }

      timeline.to({}, { duration: 0.01 }, span);
      timeline.fromTo(clusterRef.current, { rotateY: -16 }, { rotateY: 18, ease: 'none', duration: span }, 0);
      timeline.fromTo(
        cardRef.current,
        { rotateX: 8, z: 12 },
        { rotateX: -8, z: 36, ease: 'sine.inOut', duration: span },
        0
      );
      timeline.fromTo(readerRef.current, { rotateY: 12 }, { rotateY: -10, ease: 'none', duration: span }, 0);
      timeline.fromTo(
        glowRef.current,
        { rotateZ: -8, scale: 0.92, opacity: 0.45 },
        { rotateZ: 12, scale: 1.06, opacity: 0.9, ease: 'none', duration: span },
        0
      );
      if (meterRef.current) {
        timeline.fromTo(meterRef.current, { scaleX: 1 / span }, { scaleX: 1, ease: 'none', duration: span }, 0);
      }
      return timeline;
    };

    mm.add('(min-width: 860px)', () => {
      build('+=640%', '168px');
    });
    mm.add('(max-width: 859.98px)', () => {
      build('+=520%', '88px');
    });

    document.fonts?.ready?.then(() => {
      if (pinRef.current) ScrollTrigger.refresh();
    });

    return () => mm.revert();
  }, { scope: rootRef, dependencies: [reduced] });

  useEffect(() => {
    if (!reduced) return undefined;
    const nodes = STAGES.map((stage) => document.getElementById(stage.id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = STAGES.findIndex((stage) => stage.id === visible.target.id);
      if (index >= 0) setActive(index);
    }, { rootMargin: '-40% 0px -45% 0px', threshold: [0.3, 0.6] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [reduced]);

  function jump(index) {
    if (reduced) {
      document.getElementById(STAGES[index].id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }
    const trigger = ScrollTrigger.getById('how-tap-stays-safe');
    if (!trigger) return;
    const span = trigger.end - trigger.start;
    window.scrollTo({
      top: trigger.start + (span * index) / STAGES.length + 1,
      behavior: 'smooth',
    });
  }

  return (
    <article className="story-root" ref={rootRef} style={{ '--accent': STAGES[active].accent }}>
      <header className="story-intro">
        <p className="story-kicker">Classroom model</p>
        <h1 id="story-title" tabIndex={-1}>How your tap stays safe</h1>
        <p className="story-lede">
          A tap feels instant. Under it, the till and the bank run a series of checks before any money moves.
          This page walks through the checks MiniTap actually runs. It is a classroom model of how payments are protected, not the cryptography a bank would ship.
        </p>
        {!reduced && (
          <p className="story-scroll-hint">Scroll to move through the checks. Scroll up to go back.</p>
        )}
      </header>

      {reduced ? (
        <div className="story-static-list">
          <nav className="story-nav" aria-label="Story sections">
            {STAGES.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                className="story-jump"
                aria-current={active === index ? 'step' : undefined}
                onClick={() => jump(index)}
              >
                {stage.nav}
              </button>
            ))}
          </nav>
          {STAGES.map((stage) => (
            <section key={stage.id} id={stage.id} className="story-static" style={{ '--accent': stage.accent }}>
              <p className="story-kicker">{stage.kicker}</p>
              <h2>{stage.title}</h2>
              <p>{stage.body}</p>
            </section>
          ))}
        </div>
      ) : (
        <section className="story-pin" ref={pinRef} aria-label="Animated explanation of the tap checks">
          <div className="sr-only">
            <h2>Checks, in order</h2>
            <ol>
              {STAGES.map((stage) => (
                <li key={stage.id}>
                  <h3>{stage.title}</h3>
                  <p>{stage.body}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="story-chrome">
            <button type="button" className="text-btn" onClick={onBack}>Back to till</button>
            <a className="text-btn" href="#story-end">Skip the animation</a>
          </div>
          <div className="story-meter" aria-hidden="true"><span ref={meterRef} /></div>
          <div className="story-stage">
            <div
              className="story-scene"
              ref={sceneRef}
              data-stage={STAGES[active].id}
              style={{ '--accent': STAGES[active].accent }}
              aria-hidden="true"
            >
              <div className="story-depth">
                <div className="story-glow" ref={glowRef} />
                <div className="spiral-tilt">
                  <div className="spiral" ref={spiralRef}>
                    {STAGES.map((stage, index) => (
                      <div
                        key={stage.id}
                        className={active === index ? 'spiral-node is-current' : 'spiral-node'}
                        style={{ '--angle': `${index * (360 / STAGES.length)}deg` }}
                        ref={(node) => { nodeRefs.current[index] = node; }}
                      >
                        <span className="node-index">{`0${index + 1}`}</span>
                        <span className="node-name">{stage.nav}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="cluster-pos">
                  <div className="cluster" ref={clusterRef}>
                    <article className="pay-card theme-kwacha story-card" ref={cardRef}>
                      <div className="card-gloss" />
                      <div className="card-face">
                        <div className="card-top">
                          <div className="card-brand">
                            <strong>ZamPay Kwacha</strong>
                            <small>Debit · ZMW</small>
                          </div>
                          <Contactless />
                        </div>
                        <div className="chip-row"><Chip /></div>
                        <p className="pan">
                          <span>••••</span>
                          <span>••••</span>
                          <span>••••</span>
                          <span>4401</span>
                        </p>
                      </div>
                    </article>
                    <div className="story-reader" ref={readerRef}>
                      <Contactless className="contactless pad-icon" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="story-copy">
              <p className="story-count" aria-hidden="true">{`0${active + 1} / 0${STAGES.length}`}</p>
              {STAGES.map((stage, index) => (
                <div
                  key={stage.id}
                  className="story-panel"
                  aria-hidden="true"
                  ref={(node) => { panelRefs.current[index] = node; }}
                >
                  <p className="story-kicker">{stage.kicker}</p>
                  <p className="story-title">{stage.title}</p>
                  <p className="story-body">{stage.body}</p>
                </div>
              ))}
            </div>
          </div>
          <nav className="story-nav" aria-label="Story sections">
            {STAGES.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                className="story-jump"
                aria-current={active === index ? 'step' : undefined}
                onClick={() => jump(index)}
              >
                {stage.nav}
              </button>
            ))}
          </nav>
        </section>
      )}

      <footer className="story-end" id="story-end" tabIndex={-1}>
        <h2>Try it on the till</h2>
        <p>
          {reduced
            ? 'Reduced motion is on, so this page is a normal list. Nothing is pinned, and there is no 3D scene.'
            : 'Scroll up and the scene reverses with you. Above this section and below it, the page scrolls in the usual way.'}
        </p>
        <p>
          On the till, the classroom PIN is shown under the card you pick. Pay, then open the security trace. Replay the last code, or resend it with a changed amount, and read the decline.
        </p>
        <button type="button" className="tap-btn story-back" onClick={onBack}>Back to the till</button>
      </footer>
    </article>
  );
}
