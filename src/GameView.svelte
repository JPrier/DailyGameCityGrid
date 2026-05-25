<script>
  export let game;
  export let puzzle;
  export let state;
  export let latestEvaluation = null;
  export let submitInput;

  let guess = '';

  const stageLabels = [
    'Stage 0: Core roads',
    'Stage 1: Street grid',
    'Stage 2: Water and coastline',
    'Stage 3: Parks and rail',
    'Stage 4: Landmarks and neighborhoods',
    'Stage 5: Full reveal',
  ];

  $: extension = puzzle?.extension ?? {};
  $: revealedStage = Math.min(Number(state?.publicState?.revealedStage ?? state?.currentStage ?? 0), (extension.assetStages?.length ?? 1) - 1);
  $: activeStage = extension.assetStages?.[revealedStage];
  $: assetUrl = activeStage ? assetPath(activeStage.assetPath) : '';
  $: history = state?.publicState?.history ?? [];
  $: reveal = state?.publicState?.reveal;
  $: disabled = state?.status === 'won' || state?.status === 'lost';
  $: candidateNames = state?.publicState?.candidateNames ?? [];
  $: statusTone = state?.status === 'won' ? 'correct' : state?.status === 'lost' ? 'lost' : history.at(-1)?.status ?? 'neutral';

  function basePath() {
    const base = import.meta.env.BASE_URL ?? '/';
    if (!base || base === '/') return '';
    return `/${base.replace(/^\/+|\/+$/g, '')}`;
  }

  function withBase(path) {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) return path;
    const base = basePath();
    if (!base) return path.startsWith('/') ? path : `/${path}`;
    if (path === base || path.startsWith(`${base}/`)) return path;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  function assetPath(path) {
    const rel = path.replace(/^content\/assets\/?/, '');
    return withBase(`${game.assetBaseUrl}/${rel}`);
  }

  async function submit() {
    await submitInput({ kind: 'text', value: guess });
    guess = '';
  }

  function feedbackValue(item) {
    return item.displayValue ?? String(item.value);
  }
</script>

<section class="city-grid" data-testid="game-root" aria-live="polite">
  <header class="city-grid__header">
    <h2 data-testid="puzzle-title">{puzzle.display.title}</h2>
    <p data-testid="initial-prompt">{puzzle.display.initialPrompt}</p>
    <p hidden data-testid="clue-stage">{revealedStage}</p>
  </header>

  <figure class="city-grid__map" data-testid="city-grid-map">
    <figcaption data-testid="city-grid-map-stage">{stageLabels[revealedStage] ?? `Stage ${revealedStage}`}</figcaption>
    {#if assetUrl}
      <img data-testid="city-grid-stage-asset" src={assetUrl} alt={`North-up unlabeled city grid, ${stageLabels[revealedStage] ?? `Stage ${revealedStage}`}`} />
    {/if}
  </figure>

  <form class="city-grid__form" on:submit|preventDefault={submit}>
    <label for="city-grid-guess">City guess</label>
    <input id="city-grid-guess" data-testid="guess-input" bind:value={guess} disabled={disabled} autocomplete="off" list="city-grid-candidates" placeholder="Start typing one of the top 100 world cities" />
    <datalist id="city-grid-candidates">
      {#each candidateNames as name}
        <option value={name}></option>
      {/each}
    </datalist>
    <button data-testid="submit-guess" type="submit" disabled={disabled}>Guess city</button>
  </form>

  {#if state.publicState.message}
    <p class={`city-grid__status city-grid__status--${statusTone}`} data-testid="status-banner" role="status">{state.publicState.message}</p>
  {:else}
    <p class="city-grid__status city-grid__status--neutral" data-testid="status-banner" role="status">Make a guess.</p>
  {/if}

  <p class="city-grid__guess-count" data-testid="guess-count">Guesses used: {state.guessCount} / {state.maxGuesses}</p>

  <section data-testid="guess-history" aria-label="Guess history">
    {#each history as entry, index}
      <article class={`city-grid__history-row city-grid__history-row--${entry.status}`} data-testid={`guess-history-row-${index}`}>
        <header>
          <span class="city-grid__result">{entry.status === 'correct' ? 'Correct' : 'Incorrect'}</span>
          <h3>{entry.guess}</h3>
        </header>
        <div class="city-grid__feedback-grid" data-testid="feedback-panel">
          {#each entry.feedback as item}
            <p class={`city-grid__feedback city-grid__feedback--${item.severity ?? 'neutral'}`} data-testid={`guess-history-row-${index}-feedback-${item.key}`}>
              <strong>{item.label}</strong>
              <span>{feedbackValue(item)}</span>
            </p>
          {/each}
        </div>
      </article>
    {/each}
  </section>

  {#if latestEvaluation?.feedback?.length}
    <div class="city-grid__latest" aria-label="Latest feedback">
      <h3>Latest clue</h3>
      {#each latestEvaluation.feedback as item}
        <p class={`city-grid__feedback city-grid__feedback--${item.severity ?? 'neutral'}`} data-testid={`latest-feedback-${item.key}`}>
          <strong>{item.label}</strong>
          <span>{feedbackValue(item)}</span>
        </p>
      {/each}
    </div>
  {/if}

  {#if history.at(-1)?.feedback}
    <p class="city-grid__sr-only" data-testid="city-grid-distance-feedback">{history.at(-1).feedback.find((item) => item.key === 'distance')?.displayValue ?? ''}</p>
    <p class="city-grid__sr-only" data-testid="city-grid-direction-feedback">{history.at(-1).feedback.find((item) => item.key === 'direction')?.displayValue ?? ''}</p>
  {/if}

  {#if reveal}
    <aside class="city-grid__reveal" data-testid="answer-reveal">
      <h3>{reveal.canonicalName}</h3>
      <p>{reveal.admin1}, {reveal.country}</p>
      <p>Population: {reveal.population.toLocaleString()}</p>
      <p>The full north-up map is now visible: street network, water, rail, parks, and landmarks.</p>
    </aside>
  {/if}
</section>

<style>
  .city-grid {
    display: grid;
    gap: 1rem;
    max-width: 760px;
  }

  .city-grid__map {
    margin: 0;
    padding: 1rem;
    border: 1px solid rgba(34, 45, 41, 0.18);
    border-radius: 1rem;
    background: linear-gradient(145deg, #fffaf0, #ece4d2);
    box-shadow: 0 1rem 2rem rgba(30, 52, 50, 0.08);
  }

  .city-grid__map figcaption {
    margin-bottom: 0.75rem;
    font-weight: 800;
    color: #1e3432;
  }

  .city-grid__map img {
    display: block;
    width: min(100%, 680px);
    height: auto;
  }

  .city-grid__form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
  }

  .city-grid__form label {
    width: 100%;
    font-weight: 700;
  }

  .city-grid__form input {
    min-width: min(100%, 18rem);
    padding: 0.65rem 0.75rem;
    border: 1px solid rgba(30, 52, 50, 0.28);
    border-radius: 0.65rem;
  }

  .city-grid__form button {
    padding: 0.65rem 1rem;
    border: 0;
    border-radius: 0.65rem;
    background: #1e3432;
    color: #fffaf0;
    font-weight: 800;
  }

  .city-grid__status {
    margin: 0;
    padding: 0.85rem 1rem;
    border-radius: 0.85rem;
    font-weight: 800;
  }

  .city-grid__status--neutral {
    background: #ece4d2;
    color: #1e3432;
  }

  .city-grid__status--incorrect {
    background: #fff2d2;
    color: #7a3b11;
  }

  .city-grid__status--correct {
    background: #dff0d6;
    color: #24502e;
  }

  .city-grid__status--lost {
    background: #f4d8cf;
    color: #743022;
  }

  .city-grid__guess-count {
    margin: 0;
    font-weight: 700;
  }

  .city-grid__history-row,
  .city-grid__reveal {
    border-left: 0.35rem solid #226d68;
    padding: 0.75rem 1rem;
    background: rgba(34, 109, 104, 0.08);
    border-radius: 0.75rem;
  }

  .city-grid__history-row header {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    margin-bottom: 0.75rem;
  }

  .city-grid__history-row h3 {
    margin: 0;
  }

  .city-grid__result {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    font-weight: 900;
  }

  .city-grid__feedback-grid,
  .city-grid__latest {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.65rem;
  }

  .city-grid__latest {
    padding: 1rem;
    border: 1px solid rgba(30, 52, 50, 0.14);
    border-radius: 1rem;
    background: #fffaf0;
  }

  .city-grid__latest h3 {
    grid-column: 1 / -1;
    margin: 0;
  }

  .city-grid__feedback {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: #eee7d9;
    color: #1e3432;
  }

  .city-grid__feedback strong {
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .city-grid__feedback span {
    font-weight: 800;
  }

  .city-grid__feedback--hot-5,
  .city-grid__feedback--hot-4 {
    background: #b92f24;
    color: #fffaf0;
  }

  .city-grid__feedback--hot-3 {
    background: #de6b2d;
    color: #fffaf0;
  }

  .city-grid__feedback--hot-2 {
    background: #f0b44b;
    color: #3b210c;
  }

  .city-grid__feedback--cold-1 {
    background: #b9d7e1;
  }

  .city-grid__feedback--cold-2,
  .city-grid__feedback--cold-3 {
    background: #709fbd;
    color: #fffaf0;
  }

  .city-grid__feedback--good {
    background: #dff0d6;
    color: #24502e;
  }

  .city-grid__feedback--bad {
    background: #f4d8cf;
    color: #743022;
  }

  .city-grid__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
