<script lang="ts">
  import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    LinearScale,
    Tooltip,
    type ChartEvent,
    type TooltipItem,
  } from 'chart.js';

  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

  interface Props {
    labels: string[];
    values: ArrayLike<number>;
    /** CSS custom property names for the bar colors. */
    colorVar: string;
    activeColorVar: string;
    selected: number | null;
    yFormat: (v: number) => string;
    tooltipLines: (index: number) => string[];
    onSelect: (index: number) => void;
    ariaLabel: string;
    height?: number;
  }

  let { labels, values, colorVar, activeColorVar, selected, yFormat, tooltipLines, onSelect, ariaLabel, height = 220 }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let chart: Chart<'bar'> | null = null;
  let theme = $state(0);

  function css(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  $effect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => theme++;
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  $effect(() => {
    if (!canvas) return;
    chart = new Chart(canvas, {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 24, categoryPercentage: 0.9, barPercentage: 0.9 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        onClick: (evt: ChartEvent) => {
          if (!chart || !evt.native) return;
          const els = chart.getElementsAtEventForMode(evt.native, 'index', { intersect: false }, false);
          if (els.length) onSelect(els[0].index);
        },
        onHover: (evt, els) => {
          const target = evt.native?.target as HTMLElement | undefined;
          if (target) target.style.cursor = els.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items: TooltipItem<'bar'>[]) => items[0]?.label ?? '',
              label: (item: TooltipItem<'bar'>) => tooltipLines(item.dataIndex),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, autoSkipPadding: 12 } },
          y: { beginAtZero: true, border: { display: false }, ticks: { callback: (v) => yFormat(Number(v)), maxTicksLimit: 6 } },
        },
      },
    });
    return () => {
      chart?.destroy();
      chart = null;
    };
  });

  $effect(() => {
    void theme;
    if (!chart) return;
    const color = css(colorVar);
    const active = css(activeColorVar);
    const text = css('--text-muted');
    const grid = css('--chart-grid');
    const surface = css('--surface');
    const ds = chart.data.datasets[0];
    chart.data.labels = labels;
    ds.data = Array.from(values);
    ds.backgroundColor = labels.map((_, k) => (selected === null || selected === k ? (selected === k ? active : color) : color));
    const x = chart.options.scales!.x!;
    const y = chart.options.scales!.y!;
    x.ticks!.color = text;
    y.ticks!.color = text;
    y.grid = { color: grid, lineWidth: 1 };
    const tt = chart.options.plugins!.tooltip!;
    tt.backgroundColor = surface;
    tt.titleColor = css('--text');
    tt.bodyColor = css('--text');
    tt.borderColor = css('--border-strong');
    tt.borderWidth = 1;
    chart.update();
  });
</script>

<div class="chart" style:height="{height}px" role="img" aria-label={ariaLabel}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
</style>
