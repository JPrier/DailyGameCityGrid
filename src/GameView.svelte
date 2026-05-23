<script>
  export let game;
  export let puzzle;
  export let state;
  export let latestEvaluation = null;
  export let submitInput;

  let guess = '';

  const stageLabels = [
    'Stage 0: tight roads',
    'Stage 1: wider road graph',
    'Stage 2: water and coastline',
    'Stage 3: parks and rail',
    'Stage 4: landmark dots',
    'Stage 5: full reveal map',
  ];

  $: extension = puzzle?.extension ?? {};
  $: revealedStage = Math.min(Number(state?.publicState?.revealedStage ?? state?.currentStage ?? 0), (extension.assetStages?.length ?? 1) - 1);
  $: activeStage = extension.assetStages?.[revealedStage];
  $: assetUrl = activeStage ? assetPath(activeStage.assetPath) : '';
  $: history = state?.publicState?.history ?? [];
  $: reveal = state?.publicState?.reveal;
  $: disabled = state?.status === 'won' || state?.status === 'lost';

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
</script>

<section class="city-grid" data-testid="game-root" aria-live="polite">
  <header class="city-grid__header">
    <h2 data-testid="puzzle-title">{puzzle.display.title}</h2>
    <p data-testid="initial-prompt">{puzzle.display.initialPrompt}</p>
    <p data-testid="clue-stage">{revealedStage}</p>
  </header>

  <figure class="city-grid__map" data-testid="city-grid-map">
    <figcaption data-testid="city-grid-map-stage">{stageLabels[revealedStage] ?? `Stage ${revealedStage}`}</figcaption>
    {#if assetUrl}
      <img data-testid="city-grid-stage-asset" src={assetUrl} alt={`Unlabeled city grid ${stageLabels[revealedStage] ?? revealedStage}`} />
    {/if}
  </figure>

  <form class="city-grid__form" on:submit|preventDefault={submit}>
    <label for="city-grid-guess">City guess</label>
    <input id="city-grid-guess" data-testid="guess-input" bind:value={guess} disabled={disabled} autocomplete="off" list="city-grid-candidates" />
    <datalist id="city-grid-candidates">
      <option value="Boston"></option>
      <option value="Boston, MA"></option>
      <option value="Chicago"></option>
      <option value="New York"></option>
      <option value="Los Angeles"></option>
      <option value="Seattle"></option>
      <option value="London"></option>
      <option value="Paris"></option>
      <option value="Tokyo"></option>
    </datalist>
    <button data-testid="submit-guess" type="submit" disabled={disabled}>Guess city</button>
  </form>

  {#if state.publicState.message}
    <p data-testid="status-banner" role="status">{state.publicState.message}</p>
  {:else}
    <p data-testid="status-banner" role="status">Make a guess.</p>
  {/if}

  <p data-testid="guess-count">{state.guessCount}</p>

  <section data-testid="guess-history" aria-label="Guess history">
    {#each history as entry}
      <article class="city-grid__history-row">
        <h3>{entry.guess}</h3>
        <div data-testid="feedback-panel">
          {#each entry.feedback as item}
            <p data-testid={`feedback-row-${item.key}`}>
              <strong>{item.label}</strong>: <span>{String(item.value)}</span>
            </p>
          {/each}
        </div>
      </article>
    {/each}
  </section>

  {#if latestEvaluation?.feedback?.length}
    <div class="city-grid__latest" aria-label="Latest feedback">
      {#each latestEvaluation.feedback as item}
        <p data-testid={`feedback-row-${item.key}`}>
          <strong>{item.label}</strong>: <span>{String(item.value)}</span>
        </p>
      {/each}
    </div>
  {/if}

  {#if history.at(-1)?.feedback}
    <p data-testid="city-grid-distance-feedback">{history.at(-1).feedback.find((item) => item.key === 'distance')?.value ?? ''}</p>
    <p data-testid="city-grid-direction-feedback">{history.at(-1).feedback.find((item) => item.key === 'direction')?.value ?? ''}</p>
  {/if}

  {#if reveal}
    <aside class="city-grid__reveal" data-testid="answer-reveal">
      <h3>{reveal.canonicalName}</h3>
      <p>{reveal.admin1}, {reveal.country}</p>
      <p>Population: {reveal.population.toLocaleString()}</p>
      <p>Final stage explains the full map: roads, water, rail, parks, and landmarks.</p>
    </aside>
  {/if}
</section>

<style>
  .city-grid {
    display: grid;
    gap: 1rem;
  }

  .city-grid__map {
    margin: 0;
    padding: 1rem;
    border: 1px solid rgba(34, 45, 41, 0.18);
    border-radius: 1rem;
    background: #f7f1e3;
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
  }

  .city-grid__history-row,
  .city-grid__reveal {
    border-left: 0.25rem solid #226d68;
    padding: 0.75rem 1rem;
    background: rgba(34, 109, 104, 0.08);
  }
</style>
