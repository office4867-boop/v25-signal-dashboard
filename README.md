# V25 Signal Audit — GitHub Pages 저장본

이 폴더는 공개 가능한 정적 대시보드만 담는 별도 배포 저장소입니다.
`site/`에는 화면 파일과 종목별 분석 JSON만 있으며, 가격 DB·`.env`·키움
정보·실제 주문/보유 상태는 포함하지 않습니다.

## 최초 연결

1. GitHub에서 이 대시보드 전용 저장소를 만듭니다.
2. 이 폴더를 해당 저장소의 루트로 연결하고 `main` 브랜치에 올립니다.
3. GitHub 저장소의 **Settings → Pages → Build and deployment**에서
   **Source: GitHub Actions**를 선택합니다.
4. Actions의 `Deploy V25 dashboard`가 끝나면 Pages 주소가 생성됩니다.

## 평소 업데이트

상위 `실전매매` 폴더에서 다음 명령을 실행합니다.

```powershell
python v25_dashboard_export.py --all --strict
```

그다음 이 저장소에서 `site/` 변경분을 커밋하고 푸시합니다. Git을 한 번
연결한 뒤에는 상위 폴더의 `v25_dashboard_publish_github.bat`를 실행하면
내보내기, 커밋, 푸시를 순서대로 처리합니다.

일부 종목만 다시 만들 때는 다음처럼 실행할 수 있습니다.

```powershell
python v25_dashboard_export.py "삼성전기" "오이솔루션"
```

## 공개 주의

GitHub Pages 저장본은 주소를 아는 사람이 JSON을 직접 내려받을 수 있습니다.
클라이언트 화면의 비밀번호는 보안 수단이 아닙니다. 민감한 개인 매매 기록을
추가하지 말고, 접근 제한이 필요하면 인증 가능한 별도 호스팅을 사용합니다.
