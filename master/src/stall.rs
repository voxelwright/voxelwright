//! A connection whose writes may make no progress for at most a set time. A
//! client that sends a request and never reads the answer would otherwise hold
//! its connection, and the answer, for as long as it liked: hyper's header-read
//! timeout covers reading only, and a handler's timeout ends when it returns.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll, ready};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::time::{Sleep, sleep};

pub struct Stall<T> {
    io: T,
    limit: Duration,
    waiting: Option<Pin<Box<Sleep>>>,
}

impl<T> Stall<T> {
    pub fn new(io: T, limit: Duration) -> Self {
        Stall {
            io,
            limit,
            waiting: None,
        }
    }

    /// Called when a write is pending: Err once it has been pending too long.
    fn pending(&mut self, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let limit = self.limit;
        let timer = self.waiting.get_or_insert_with(|| Box::pin(sleep(limit)));
        ready!(timer.as_mut().poll(cx));
        Poll::Ready(Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the client stopped reading",
        )))
    }

    fn progress<R>(&mut self, r: Poll<R>, cx: &mut Context<'_>) -> Poll<io::Result<R>> {
        match r {
            Poll::Ready(v) => {
                self.waiting = None;
                Poll::Ready(Ok(v))
            }
            Poll::Pending => match self.pending(cx) {
                Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
                _ => Poll::Pending,
            },
        }
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for Stall<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_read(cx, buf)
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for Stall<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let r = Pin::new(&mut self.io).poll_write(cx, buf);
        self.progress(r, cx).map(|r| r.and_then(|x| x))
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        let r = Pin::new(&mut self.io).poll_write_vectored(cx, bufs);
        self.progress(r, cx).map(|r| r.and_then(|x| x))
    }

    fn is_write_vectored(&self) -> bool {
        self.io.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let r = Pin::new(&mut self.io).poll_flush(cx);
        self.progress(r, cx).map(|r| r.and_then(|x| x))
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn a_reader_that_never_reads_ends_the_write() {
        let (a, _b) = tokio::io::duplex(1024); // _b is never read
        let mut s = Stall::new(a, Duration::from_millis(200));
        let t0 = std::time::Instant::now();
        let err = s.write_all(&[0u8; 64 * 1024]).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(t0.elapsed() >= Duration::from_millis(200));
    }

    #[tokio::test]
    async fn a_slow_reader_that_keeps_reading_is_fine() {
        use tokio::io::AsyncReadExt;
        let (a, mut b) = tokio::io::duplex(1024);
        let reader = tokio::spawn(async move {
            let mut buf = [0u8; 512];
            let mut got = 0;
            while got < 16 * 1024 {
                tokio::time::sleep(Duration::from_millis(20)).await;
                got += b.read(&mut buf).await.unwrap();
            }
        });
        let mut s = Stall::new(a, Duration::from_millis(200));
        s.write_all(&[0u8; 16 * 1024]).await.unwrap();
        reader.await.unwrap();
    }
}
