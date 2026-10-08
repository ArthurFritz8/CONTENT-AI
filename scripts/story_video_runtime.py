"""Resource limits shared by deployment and execution/cost identity."""
# Modal generator Functions reject even retries=0; omit the option entirely.
GPU_OPTIONS = dict(gpu="H100", cpu=(4, 4), memory=(65536, 65536), timeout=2100,
    startup_timeout=180, max_containers=1, min_containers=0,
    buffer_containers=0, scaledown_window=2, restrict_modal_access=True,
    block_network=True, is_generator=True)
CPU_OPTIONS = dict(cpu=(0.25, 0.25), memory=(512, 512), timeout=2700,
    startup_timeout=120, retries=0, max_containers=1, min_containers=0,
    buffer_containers=0, scaledown_window=2)
