"""Select the retained observations for one square, using its recipe's source readers."""


import argparse


def fixture_option(parser):
    parser.add_argument("--public-works-fixtures", action=argparse.BooleanOptionalAction, default=True,
                        help="include San Francisco Public Works lamp positions and trolley wires")


def sidecars(archive, sources, public_works_fixtures):
    yield "detail", lambda dest: sources.acquire(archive, dest)
    if public_works_fixtures:
        yield "fixtures", lambda dest: sources.public_works(archive.stem, dest)
    yield "stops", lambda dest: sources.stop_signs(archive.stem, dest)
