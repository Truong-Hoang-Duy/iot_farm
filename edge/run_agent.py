#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Điểm vào: python3 run_agent.py --config config.ini [--simulate] [--once] ...

Xem `python3 run_agent.py --help` và README.md.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from farm_agent.main import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
