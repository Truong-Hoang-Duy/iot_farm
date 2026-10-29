import { BookOpen, ExternalLink, Scale, Split } from 'lucide-react';

const REFERENCES: { text: string; doi?: string; url?: string }[] = [
  { text: 'Chen, T. & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System. Proc. KDD ’16, 785–794.', doi: '10.1145/2939672.2939785' },
  { text: 'Hochreiter, S. & Schmidhuber, J. (1997). Long Short-Term Memory. Neural Computation, 9(8), 1735–1780.', doi: '10.1162/neco.1997.9.8.1735' },
  { text: 'Challu, C., Olivares, K. G., Oreshkin, B. N., Garza, F., Mergenthaler-Canseco, M. & Dubrawski, A. (2023). N-HiTS: Neural Hierarchical Interpolation for Time Series Forecasting. AAAI, 37(6), 6989–6997.', doi: '10.1609/aaai.v37i6.25854' },
  { text: 'Nie, Y., Nguyen, N. H., Sinthong, P. & Kalagnanam, J. (2023). A Time Series is Worth 64 Words: Long-term Forecasting with Transformers (PatchTST). ICLR 2023.', doi: '10.48550/arXiv.2211.14730' },
  { text: 'Ansari, A. F. et al. (2024). Chronos: Learning the Language of Time Series. Transactions on Machine Learning Research.', doi: '10.48550/arXiv.2403.07815' },
  { text: 'Hyndman, R. J. & Koehler, A. B. (2006). Another look at measures of forecast accuracy. International Journal of Forecasting, 22(4), 679–688.', doi: '10.1016/j.ijforecast.2006.03.001' },
  { text: 'Tashman, L. J. (2000). Out-of-sample tests of forecasting accuracy: an analysis and review. International Journal of Forecasting, 16(4), 437–450.', doi: '10.1016/S0169-2070(00)00065-0' },
  { text: 'Bergmeir, C. & Benítez, J. M. (2012). On the use of cross-validation for time series predictor evaluation. Information Sciences, 191, 192–213.', doi: '10.1016/j.ins.2011.12.028' },
  { text: 'Makridakis, S., Spiliotis, E. & Assimakopoulos, V. (2022). M5 accuracy competition: Results, findings, and conclusions. International Journal of Forecasting, 38(4), 1346–1364.', doi: '10.1016/j.ijforecast.2021.11.013' },
  { text: 'Taieb, S. B., Bontempi, G., Atiya, A. F. & Sorjamaa, A. (2012). A review and comparison of strategies for multi-step ahead time series forecasting. Expert Systems with Applications, 39(8), 7067–7083.', doi: '10.1016/j.eswa.2012.01.039' },
  { text: 'Hyndman, R. J. & Athanasopoulos, G. (2021). Forecasting: Principles and Practice (3rd ed.). OTexts.', url: 'https://otexts.com/fpp3/' },
];

const METRIC_DEFS: { name: string; formula: string; note: string }[] = [
  { name: 'MAE', formula: 'MAE = (1/n) · Σ |yᵢ − ŷᵢ|', note: 'Sai số tuyệt đối trung bình, cùng đơn vị với biến đo (vd. % độ ẩm).' },
  { name: 'RMSE', formula: 'RMSE = √[ (1/n) · Σ (yᵢ − ŷᵢ)² ]', note: 'Bình phương sai số trước khi lấy trung bình ⇒ phạt nặng sai số lớn.' },
  { name: 'MAPE', formula: 'MAPE = (100%/n) · Σ |yᵢ − ŷᵢ| / |yᵢ|', note: 'Sai số tương đối; không ổn định khi yᵢ gần 0.' },
  { name: 'sMAPE', formula: 'sMAPE = (100%/n) · Σ 2·|yᵢ − ŷᵢ| / (|yᵢ| + |ŷᵢ|)', note: 'Phiên bản đối xứng, bị chặn trong [0, 200%].' },
  {
    name: 'MASE',
    formula: 'MASE = MAE_mô hình / MAE_SeasonalNaive,   với ŷᵢ(SN) = yᵢ₋ₘ (m = số bước trong 1 ngày)',
    note: 'Không phụ thuộc thang đo; MASE < 1 ⇒ tốt hơn baseline Seasonal Naive (Hyndman & Koehler, 2006).',
  },
  { name: 'R²', formula: 'R² = 1 − Σ (yᵢ − ŷᵢ)² / Σ (yᵢ − ȳ)²', note: 'Tỷ lệ phương sai được giải thích; 1 là hoàn hảo, ≤ 0 là không tốt hơn trung bình.' },
  {
    name: 'Coverage 80%',
    formula: 'Cov80 = (1/n) · Σ 𝟙[ loᵢ ≤ yᵢ ≤ hiᵢ ],   lo = q10, hi = q90',
    note: 'Kiểm tra độ hiệu chỉnh của khoảng dự báo; lý tưởng ≈ 0,80.',
  },
];

export function MethodologySection() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-6">
      <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-primary" />
        Phương pháp đánh giá
      </h2>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Split className="h-4 w-4 text-primary" /> Chia dữ liệu – không huấn luyện trên toàn bộ khi đánh giá
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
          <li>
            Dữ liệu cảm biến được resample về lưới <b className="text-foreground">5 phút</b> (ngắn hạn: 5′ → 12h, cửa sổ vào 2 ngày) và{' '}
            <b className="text-foreground">1 giờ</b> (dài hạn: 1 → 5 ngày, cửa sổ vào 14 ngày, kèm biến thời tiết Open-Meteo).
          </li>
          <li>
            Chia <b className="text-foreground">theo thời gian, không xáo trộn</b>: Train 70% → Validation 10% → Test 20% (đoạn cuối cùng).
            Xáo trộn ngẫu nhiên sẽ làm rò rỉ thông tin tương lai vào quá khứ.
          </li>
          <li>Scaler/chuẩn hoá chỉ được fit trên tập train. Validation dùng cho early-stopping và chọn siêu tham số.</li>
          <li>
            Tập test chỉ dùng một lần, đánh giá bằng <b className="text-foreground">rolling-origin</b>: nhiều thời điểm phát dự báo trượt dọc
            tập test, mỗi lần chỉ dùng dữ liệu trước thời điểm đó (Tashman, 2000).
          </li>
          <li>
            Sau khi có chỉ số, mô hình được <b className="text-foreground">huấn luyện lại (refit) trên toàn bộ dữ liệu</b> để dự báo thực tế; chỉ số
            báo cáo vẫn là của tập test. Mô hình “Tốt nhất” cho mỗi (biến, horizon) = MASE thấp nhất trên test.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" /> Định nghĩa chỉ số
        </h3>
        <p className="text-xs text-muted-foreground">yᵢ: giá trị thật, ŷᵢ: giá trị dự báo, n: số điểm đánh giá, ȳ: trung bình giá trị thật.</p>
        <div className="grid gap-2 md:grid-cols-2">
          {METRIC_DEFS.map((m) => (
            <div key={m.name} className="rounded-xl border border-border bg-secondary/20 p-3 space-y-1">
              <div className="text-sm font-semibold">{m.name}</div>
              <code className="block text-xs font-mono bg-background rounded-md px-2 py-1.5 border border-border overflow-x-auto whitespace-nowrap">
                {m.formula}
              </code>
              <p className="text-xs text-muted-foreground">{m.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Tài liệu tham khảo</h3>
        <ol className="list-decimal pl-5 space-y-1.5 text-xs">
          {REFERENCES.map((r) => {
            const href = r.doi ? `https://doi.org/${r.doi}` : r.url;
            return (
              <li key={r.text} className="leading-relaxed">
                <span>{r.text} </span>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline break-all">
                    {r.doi ? `doi:${r.doi}` : href}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
