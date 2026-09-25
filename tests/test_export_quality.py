"""Snapshot coverage is honest about missing and extra windows; no video/DB needed."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from badminton import export_web
from badminton.export_web import _rally_coverage, _write


def test_coverage():
    assert _rally_coverage({}) == []
    rows = _rally_coverage({
        'set_finals': {'2': [1, 1], '1': [2, 1]},
        'rallies': [
            {'set_no': 1, 'winner': 'A'}, {'set_no': 1, 'winner': None},
            {'set_no': 2, 'winner': 'A'}, {'set_no': 2, 'winner': 'B'},
            {'set_no': 2, 'winner': 'A'},
        ],
    })
    assert rows == [
        dict(set=1, expected=3, detected=2, missing=1, unknownWinners=1),
        dict(set=2, expected=2, detected=3, missing=-1, unknownWinners=0),
    ]


def test_failed_json_write_preserves_previous_export():
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'data.json'
        _write(path, {'missing': float('nan'), 'invalid': float('inf')})
        assert json.loads(path.read_text()) == {'missing': None, 'invalid': None}
        _write(path, {'previous': True})
        before = path.read_bytes()
        with patch.object(Path, 'replace', side_effect=OSError('disk failure')):
            try:
                _write(path, {'new': True})
            except OSError:
                pass
            else:
                raise AssertionError('write should fail')
        assert path.read_bytes() == before
        assert list(path.parent.iterdir()) == [path]


def test_single_frame_rally_maps_to_its_clip():
    clips = [(100, 200, 'clip.mp4')]
    assert export_web._clip_for(150, 150, clips) == 'clip.mp4'
    assert export_web._clip_for(99, 99, clips) is None
    assert export_web._clip_for(100, 100, clips) == 'clip.mp4'
    assert export_web._clip_for(150, 150, []) is None
    assert export_web._clip_for(0, 1000, clips) is None


def test_single_match_refresh_preserves_picker():
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'index.json'
        _write(path, {'matches': [{'id': 'first', 'old': True}, {'id': 'second'}]})
        con = Mock()
        con.execute.return_value.fetchall.return_value = [('first',), ('second',)]
        with patch.object(export_web.db, 'connect', return_value=con), \
                patch.object(export_web.config, 'get_match', return_value={}), \
                patch.object(export_web, 'export_match', return_value={'id': 'first', 'new': True}), \
                patch('sys.argv', ['export_web', '--match', 'first', '--out', directory]):
            export_web.main()
        assert json.loads(path.read_text())['matches'] == [{'id': 'first', 'new': True}, {'id': 'second'}]


def test_exported_contact_timing():
    root = Path(__file__).resolve().parents[1] / 'web/public/data'
    index = json.loads((root / 'index.json').read_text())
    for match in index['matches']:
        for source in match['sources']:
            bundle = json.loads((root / match['id'] / f'{source}.json').read_text())
            expected = export_web.hits.shuttle_offset(match['id']) - export_web.SS_OFFSET if source == 'labels' else 0
            assert bundle['meta']['contactFrameOffset'] == expected
    assert export_web.hits.shuttle_offset('denmark_open_2022_sf') - export_web.SS_OFFSET == -9


if __name__ == '__main__':
    for test in [test_coverage, test_failed_json_write_preserves_previous_export, test_single_match_refresh_preserves_picker, test_single_frame_rally_maps_to_its_clip, test_exported_contact_timing]:
        test()
        print(f'PASS {test.__name__}')
