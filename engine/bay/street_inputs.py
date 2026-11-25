"""Select the retained observations for one square, using its recipe's source readers."""


def sidecars(archive, sources, public_works_fixtures=False):
    yield "detail", lambda dest: sources.acquire(archive, dest)
    if public_works_fixtures:
        yield "fixtures", lambda dest: sources.public_works(archive.stem, dest)
    yield "stops", lambda dest: sources.stop_signs(archive.stem, dest)
